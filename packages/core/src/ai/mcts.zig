//! Determinized Monte Carlo tree search with explicit chance nodes (Hard and
//! Expert tiers).
//!
//! The tree alternates decision nodes (one player picks a move for a known
//! tile) and chance nodes (which tile the next player draws). Every iteration:
//!
//! 1. determinizes: the unseen tiles are reshuffled, so everything past the
//!    tree (rollouts) sees a sample of the hidden pile. The real order is
//!    never used, only the unseen multiset;
//! 2. descends decision nodes with UCB1 from the point of view of the player
//!    to move (values are vectors, one per player, so 3-5 player games work).
//!    Children are sorted by the one-ply heuristic and only the best
//!    `widen_base + widen_rate * sqrt(visits)` are eligible (progressive
//!    widening over the large move set);
//! 3. at a chance node, picks the tile type whose visits lag its probability
//!    most (stratified sampling) and forces that draw into the determinized
//!    pile. Chance values are probability-weighted means over the explored
//!    tile types, which removes most of the draw noise between sibling moves;
//! 4. expands a new decision node by scoring all its moves with the
//!    heuristic. Its value comes from a rollout that starts with its best move
//!    and continues with heuristic plies until the searching player is to
//!    move again, plus `rollout_cycles` extra rounds (so every leaf has the
//!    same horizon). Opponents in rollouts pick from `opponent_samples` moves
//!    (0 = all of them, i.e. they are modelled as Medium players);
//! 5. backs values up: a decision node is worth its best explored child for
//!    the player to move, a chance node its weighted mean.
//!
//! The result is deterministic for a given seed and iteration count.
const std = @import("std");
const engine = @import("../engine/engine.zig");
const tiles = @import("../engine/tiles.zig");
const Rng = @import("../engine/rng.zig").Rng;
const movegen = @import("movegen.zig");
const eval = @import("eval.zig");

const Game = engine.Game;
const Move = engine.Move;
const Values = eval.Values;
const Params = eval.Params;
const NONE: u32 = 0xffff_ffff;

pub const Config = struct {
    /// Iterations when the caller gives no budget.
    default_iterations: u32,
    /// Deepest decision level the tree grows to (1 = root moves only).
    max_depth: u8,
    /// Extra full rounds simulated from a leaf before evaluating.
    rollout_cycles: u8,
    /// Moves sampled per rollout ply for the searching player.
    rollout_samples: u8,
    /// Moves sampled per rollout ply for opponents (0 = all moves, i.e. Medium).
    opponent_samples: u8,
    /// UCB exploration constant, in points of margin.
    explore: f32,
    /// Progressive widening.
    widen_base: f32,
    widen_rate: f32,
    /// Children kept per non-root node (best by heuristic).
    max_children: u16,
};

const Child = struct {
    move: Move,
    /// One-ply heuristic value vector after the move.
    h: Values,
    /// Backed-up value (valid once visited).
    value: Values = @splat(0),
    /// Sum of leaf values for children evaluated directly (no chance node).
    sum: Values = @splat(0),
    visits: u32 = 0,
    chance: u32 = NONE,
};

const Node = struct {
    player: u8,
    first: u32,
    len: u32,
    visits: u32 = 0,
    value: Values = @splat(0),
};

const Chance = struct { first: u32, len: u32 };

const Outcome = struct {
    tile: tiles.TileIndex,
    prob: f32,
    node: u32 = NONE,
    visits: u32 = 0,
    dead: bool = false,
};

const Step = struct { node: u32, child: u32, outcome: u32 = NONE };

pub const Search = struct {
    gpa: std.mem.Allocator,
    params: *const Params,
    cfg: Config,
    me: u8,
    num_players: u8,
    nodes: std.ArrayList(Node) = .empty,
    children: std.ArrayList(Child) = .empty,
    chances: std.ArrayList(Chance) = .empty,
    outcomes: std.ArrayList(Outcome) = .empty,
    moves_buf: []Move,
    vals_buf: []Values,
    order_buf: []u32,
    rng: Rng,
    /// Work done so far, in apply+evaluate calls (the unit `budget_ms` is
    /// calibrated in, since an iteration's cost grows with the move count).
    work: u64 = 0,

    pub fn deinit(self: *Search) void {
        self.nodes.deinit(self.gpa);
        self.children.deinit(self.gpa);
        self.chances.deinit(self.gpa);
        self.outcomes.deinit(self.gpa);
    }

    fn margin(self: *const Search, v: Values, p: u8) f32 {
        return eval.margin(v, self.num_players, p);
    }

    /// Expand a decision node for `sim` (current player to move), keeping the
    /// best `keep` moves by heuristic. Returns the node index.
    fn expand(self: *Search, sim: *const Game, keep: u32) error{OutOfMemory}!u32 {
        const moves = movegen.generate(sim, self.moves_buf);
        const player = sim.current_player;
        const n = moves.len;
        self.work += n;
        for (moves, 0..) |m, i| {
            var c = sim.*;
            c.apply(m, null) catch {
                self.vals_buf[i] = @splat(-1e6);
                continue;
            };
            self.vals_buf[i] = eval.evaluate(&c, self.params);
        }
        const order = self.order_buf[0..n];
        for (order, 0..) |*o, i| o.* = @intCast(i);
        const Ctx = struct { vals: []Values, np: u8, p: u8 };
        std.sort.pdq(u32, order, Ctx{ .vals = self.vals_buf, .np = sim.num_players, .p = player }, struct {
            fn lt(ctx: Ctx, a: u32, b: u32) bool {
                const va = eval.margin(ctx.vals[a], ctx.np, ctx.p);
                const vb = eval.margin(ctx.vals[b], ctx.np, ctx.p);
                if (va != vb) return va > vb;
                return a < b;
            }
        }.lt);
        const k: u32 = @intCast(@min(n, keep));
        const first: u32 = @intCast(self.children.items.len);
        try self.children.ensureUnusedCapacity(self.gpa, k);
        for (order[0..k]) |idx| {
            self.children.appendAssumeCapacity(.{ .move = moves[idx], .h = self.vals_buf[idx] });
        }
        try self.nodes.append(self.gpa, .{ .player = player, .first = first, .len = k });
        return @intCast(self.nodes.items.len - 1);
    }

    /// Chance node for the draw that follows a move: the unseen tiles of `sim`
    /// (pile + the tile just drawn), grouped by type. River tiles come first
    /// and the lake only once the other river tiles are gone, as in the pile.
    fn makeChance(self: *Search, sim: *const Game) error{OutOfMemory}!u32 {
        var counts: [tiles.count]u16 = @splat(0);
        for (sim.remainingDeck()) |t| counts[t] += 1;
        counts[sim.current_tile] += 1;
        const lake = tiles.indexOfComptime("R12");
        var river_left: u32 = 0;
        for (counts, 0..) |c, t| {
            if (c > 0 and tiles.isRiver(@intCast(t)) and t != lake) river_left += c;
        }
        const lake_only = river_left == 0 and counts[lake] > 0;
        var total: f32 = 0;
        const first: u32 = @intCast(self.outcomes.items.len);
        for (counts, 0..) |c, ti| {
            if (c == 0) continue;
            const t: tiles.TileIndex = @intCast(ti);
            const allowed = if (river_left > 0)
                tiles.isRiver(t) and t != lake
            else if (lake_only)
                t == lake
            else
                !tiles.isRiver(t);
            if (!allowed) continue;
            try self.outcomes.append(self.gpa, .{ .tile = t, .prob = @floatFromInt(c) });
            total += @floatFromInt(c);
        }
        const len: u32 = @intCast(self.outcomes.items.len - first);
        for (self.outcomes.items[first..]) |*o| o.prob /= total;
        try self.chances.append(self.gpa, .{ .first = first, .len = len });
        return @intCast(self.chances.items.len - 1);
    }

    /// Make the determinized pile deliver `t` as the drawn tile.
    fn forceDraw(sim: *Game, t: tiles.TileIndex) void {
        if (sim.current_tile == t) return;
        for (sim.deck[sim.deck_pos..sim.deck_len]) |*d| {
            if (d.* == t) {
                d.* = sim.current_tile;
                sim.current_tile = t;
                return;
            }
        }
    }

    fn childScore(self: *const Search, ch: *const Child, player: u8) f32 {
        return self.margin(if (ch.visits > 0) ch.value else ch.h, player);
    }

    fn selectChild(self: *Search, ni: u32) u32 {
        const node = self.nodes.items[ni];
        const nv: f32 = @floatFromInt(node.visits);
        const width: u32 = @max(1, @min(node.len, @as(u32, @intFromFloat(self.cfg.widen_base + self.cfg.widen_rate * @sqrt(nv)))));
        const log_n = @log(nv + 1);
        var best: u32 = node.first;
        var best_u: f32 = -std.math.inf(f32);
        for (node.first..node.first + width) |ci| {
            const ch = &self.children.items[ci];
            const n_i: f32 = @floatFromInt(ch.visits);
            const u = self.childScore(ch, node.player) + self.cfg.explore * @sqrt(log_n / (n_i + 1));
            if (u > best_u) {
                best_u = u;
                best = @intCast(ci);
            }
        }
        return best;
    }

    fn selectOutcome(self: *Search, chi: u32) ?u32 {
        const ch = self.chances.items[chi];
        var best: ?u32 = null;
        var best_k: f32 = -1;
        for (ch.first..ch.first + ch.len) |oi| {
            const o = &self.outcomes.items[oi];
            if (o.dead) continue;
            const k = o.prob / @as(f32, @floatFromInt(o.visits + 1));
            if (k > best_k) {
                best_k = k;
                best = @intCast(oi);
            }
        }
        return best;
    }

    /// Heuristic rollout from `sim` until the searching player is to move
    /// (after `rollout_cycles` extra rounds), then evaluate.
    fn rollout(self: *Search, sim: *Game) Values {
        self.work += 1;
        var cycles = self.cfg.rollout_cycles;
        var guard: u32 = 0;
        while (sim.status == .playing and guard < 64) : (guard += 1) {
            if (sim.current_player == self.me) {
                if (cycles == 0) break;
                cycles -= 1;
            }
            const samples = if (sim.current_player == self.me) self.cfg.rollout_samples else self.cfg.opponent_samples;
            const m = self.rolloutMove(sim, samples) orelse break;
            sim.apply(m, null) catch break;
        }
        return eval.evaluate(sim, self.params);
    }

    fn rolloutMove(self: *Search, sim: *const Game, samples: u8) ?Move {
        const moves = movegen.generate(sim, self.moves_buf);
        if (moves.len == 0) return null;
        const p = sim.current_player;
        var best: ?Move = null;
        var best_v: f32 = -std.math.inf(f32);
        const all = samples == 0 or moves.len <= samples;
        const n = if (all) moves.len else samples;
        self.work += n;
        for (0..n) |k| {
            const m = if (all) moves[k] else moves[@intCast(self.rng.below(moves.len))];
            var c = sim.*;
            c.apply(m, null) catch continue;
            const v = self.margin(eval.evaluate(&c, self.params), p);
            if (v > best_v) {
                best_v = v;
                best = m;
            }
        }
        return best;
    }

    /// Value of a freshly expanded node: its best move, then a rollout.
    fn leafValue(self: *Search, sim: *Game, ni: u32) Values {
        const node = self.nodes.items[ni];
        const best = &self.children.items[node.first];
        const next = (node.player + 1) % self.num_players;
        var v: Values = undefined;
        if (self.cfg.rollout_cycles == 0 and next == self.me) {
            // The best move's heuristic already sits at the leaf horizon.
            v = best.h;
        } else {
            sim.apply(best.move, null) catch return best.h;
            v = self.rollout(sim);
        }
        best.visits = 1;
        best.sum = v;
        best.value = v;
        return v;
    }

    fn refreshChild(self: *Search, ci: u32) void {
        const ch = &self.children.items[ci];
        if (ch.chance == NONE) {
            const n: f32 = @floatFromInt(@max(1, ch.visits));
            for (0..engine.MAX_PLAYERS) |p| ch.value[p] = ch.sum[p] / n;
            return;
        }
        const cn = self.chances.items[ch.chance];
        var acc: Values = @splat(0);
        var mass: f32 = 0;
        for (self.outcomes.items[cn.first .. cn.first + cn.len]) |o| {
            if (o.dead or o.node == NONE) continue;
            const nv = self.nodes.items[o.node].value;
            for (0..engine.MAX_PLAYERS) |p| acc[p] += o.prob * nv[p];
            mass += o.prob;
        }
        if (mass > 0) {
            for (0..engine.MAX_PLAYERS) |p| ch.value[p] = acc[p] / mass;
        }
    }

    fn refreshNode(self: *Search, ni: u32) void {
        const node = &self.nodes.items[ni];
        var best: ?u32 = null;
        var best_m: f32 = -std.math.inf(f32);
        for (node.first..node.first + node.len) |ci| {
            const ch = &self.children.items[ci];
            if (ch.visits == 0) continue;
            const m = self.margin(ch.value, node.player);
            if (m > best_m) {
                best_m = m;
                best = @intCast(ci);
            }
        }
        if (best) |b| node.value = self.children.items[b].value;
    }

    fn iterate(self: *Search, root_game: *const Game) error{OutOfMemory}!void {
        var sim = root_game.*;
        determinize(&sim, &self.rng);
        var path: [32]Step = undefined;
        var depth: usize = 0;
        var ni: u32 = 0;
        var leaf: ?Values = null;
        while (true) {
            const ci = self.selectChild(ni);
            path[depth] = .{ .node = ni, .child = ci };
            depth += 1;
            self.work += 1;
            sim.apply(self.children.items[ci].move, null) catch {
                leaf = self.children.items[ci].h;
                break;
            };
            if (sim.status != .playing) {
                leaf = eval.evaluate(&sim, self.params);
                break;
            }
            if (depth >= self.cfg.max_depth or depth >= path.len) {
                leaf = if (sim.current_player == self.me and self.cfg.rollout_cycles == 0)
                    eval.evaluate(&sim, self.params)
                else
                    self.rollout(&sim);
                break;
            }
            if (self.children.items[ci].chance == NONE) {
                const chi = try self.makeChance(&sim);
                self.children.items[ci].chance = chi;
            }
            const oi = self.selectOutcome(self.children.items[ci].chance) orelse {
                leaf = eval.evaluate(&sim, self.params);
                self.children.items[ci].chance = NONE;
                break;
            };
            path[depth - 1].outcome = oi;
            forceDraw(&sim, self.outcomes.items[oi].tile);
            if (self.outcomes.items[oi].node == NONE) {
                const nn = try self.expand(&sim, self.cfg.max_children);
                if (self.nodes.items[nn].len == 0) {
                    // The tile fits nowhere: in a real game it is discarded.
                    self.outcomes.items[oi].dead = true;
                    path[depth - 1].outcome = NONE;
                    self.unwind(path[0..depth], null);
                    return;
                }
                self.outcomes.items[oi].node = nn;
                const v = self.leafValue(&sim, nn);
                self.nodes.items[nn].value = v;
                self.nodes.items[nn].visits = 1;
                self.outcomes.items[oi].visits += 1;
                break;
            }
            self.outcomes.items[oi].visits += 1;
            ni = self.outcomes.items[oi].node;
        }
        self.unwind(path[0..depth], leaf);
    }

    /// Back values up the path. `leaf` is the value at the bottom when the
    /// last step ended without a chance node (terminal, depth cap).
    fn unwind(self: *Search, path: []const Step, leaf: ?Values) void {
        var i = path.len;
        while (i > 0) {
            i -= 1;
            const st = path[i];
            const ch = &self.children.items[st.child];
            ch.visits += 1;
            self.nodes.items[st.node].visits += 1;
            if (i == path.len - 1 and leaf != null and (ch.chance == NONE or st.outcome == NONE)) {
                for (0..engine.MAX_PLAYERS) |p| ch.sum[p] += leaf.?[p];
                if (ch.chance == NONE) {
                    self.refreshChild(st.child);
                } else if (self.chanceExplored(ch.chance)) {
                    self.refreshChild(st.child);
                } else {
                    const n: f32 = @floatFromInt(ch.visits);
                    for (0..engine.MAX_PLAYERS) |p| ch.value[p] = ch.sum[p] / n;
                }
            } else if (ch.chance != NONE and self.chanceExplored(ch.chance)) {
                self.refreshChild(st.child);
            } else if (ch.visits == 1) {
                ch.value = ch.h;
            }
            self.refreshNode(st.node);
        }
    }

    fn chanceExplored(self: *const Search, chi: u32) bool {
        const cn = self.chances.items[chi];
        for (self.outcomes.items[cn.first .. cn.first + cn.len]) |o| {
            if (!o.dead and o.node != NONE) return true;
        }
        return false;
    }

    /// Run up to `iterations` iterations (and at most `max_work` units of work,
    /// when given) from `root` and return the chosen move.
    pub fn run(self: *Search, root: *const Game, iterations: u32, max_work: ?u64) error{OutOfMemory}!Move {
        try self.nodes.ensureTotalCapacity(self.gpa, @min(iterations, 4096) + 1);
        _ = try self.expand(root, @intCast(self.moves_buf.len));
        const r = self.nodes.items[0];
        if (r.len == 1) return self.children.items[r.first].move;
        var it: u32 = 0;
        while (it < iterations) : (it += 1) {
            if (max_work) |w| {
                if (self.work >= w) break;
            }
            try self.iterate(root);
        }
        // Most visited root child; ties go to the better value.
        var best: u32 = r.first;
        var best_key: f32 = -std.math.inf(f32);
        for (r.first..r.first + r.len) |ci| {
            const ch = &self.children.items[ci];
            const key = @as(f32, @floatFromInt(ch.visits)) * 1e4 + self.childScore(ch, r.player);
            if (key > best_key) {
                best_key = key;
                best = @intCast(ci);
            }
        }
        return self.children.items[best].move;
    }
};

/// Shuffle the unseen part of the pile (the searching player cannot know its
/// order). The pile is sorted first so the result depends only on the unseen
/// multiset; river tiles stay in front with the lake last, as in setup.
pub fn determinize(sim: *Game, rng: *Rng) void {
    const rest = sim.deck[sim.deck_pos..sim.deck_len];
    std.sort.pdq(tiles.TileIndex, rest, {}, std.sort.asc(tiles.TileIndex));
    rng.shuffle(tiles.TileIndex, rest);
    var rivers: usize = 0;
    for (rest) |t| {
        if (tiles.isRiver(t)) rivers += 1;
    }
    if (rivers == 0) return;
    const lake = tiles.indexOfComptime("R12");
    var tmp: [engine.MAX_SLOTS]tiles.TileIndex = undefined;
    var n: usize = 0;
    var has_lake = false;
    for (rest) |t| {
        if (t == lake) {
            has_lake = true;
        } else if (tiles.isRiver(t)) {
            tmp[n] = t;
            n += 1;
        }
    }
    if (has_lake) {
        tmp[n] = lake;
        n += 1;
    }
    for (rest) |t| {
        if (!tiles.isRiver(t)) {
            tmp[n] = t;
            n += 1;
        }
    }
    @memcpy(rest, tmp[0..n]);
}
