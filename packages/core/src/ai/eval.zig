//! Static evaluation: an estimate of every player's final score from a state.
//!
//! value[p] = score[p]
//!          + expected value of each figure-held feature, credited to its majority
//!          + meeple economy (supply worth, discounted by the turns left)
//!
//! Features:
//! - Roads and cities: the chance to complete comes from the open edges and the
//!   unseen tiles that fit each open cell. A cell no unseen tile fits makes the
//!   feature dead (it can only score its end-of-game value).
//! - Cloisters and gardens: current neighbours plus the chance each empty
//!   neighbour cell gets filled.
//! - Fields: 3 per completed adjacent city plus the completion chance of each
//!   incomplete one, plus a small growth term early in the game.
//!
//! The evaluation only reads public information: the unseen tile multiset is the
//! draw pile plus the tile in hand, never the pile's order.
const std = @import("std");
const engine = @import("../engine/engine.zig");
const tiles = @import("../engine/tiles.zig");
const movegen = @import("movegen.zig");

const Game = engine.Game;
const FeatureKind = engine.FeatureKind;
const MAX_PLAYERS = engine.MAX_PLAYERS;
const NONE8: u8 = 0xff;

pub const Values = [MAX_PLAYERS]f32;

pub const Params = struct {
    /// Share of a player's own turns that can go towards one feature.
    own_turns: f32 = 0.6,
    /// Completion penalty for each open cell beyond the first (cities grow).
    city_branch: f32 = 0.75,
    road_branch: f32 = 0.92,
    /// Draws by other players that may incidentally fill a cloister neighbour.
    incidental: f32 = 0.08,
    /// Worth of one meeple in supply with plenty of turns left.
    meeple_value: f32 = 9.0,
    /// Turns after which a supply meeple has its full worth.
    meeple_horizon: f32 = 5.0,
    /// Extra turns needed per additional supply meeple (diminishing returns).
    meeple_spacing: f32 = 2.5,
    /// Credit for meeples expected to come back from features.
    return_credit: f32 = 0.5,
    /// Worth of the abbot in supply when a cloister/garden is likely to come.
    abbot_value: f32 = 4.0,
    /// Field growth potential at the start of the game, in points.
    field_growth: f32 = 2.0,
    /// Points a farmer gets per completed city (3rd edition).
    farm_city_points: f32 = 3.0,
};

pub const default_params: Params = .{};

const MAX_ENTRIES = 96;
const MAX_CELLS = 24;
const MAX_CITIES = 24;

const Entry = struct {
    root: u16,
    kind: FeatureKind,
    counts: [MAX_PLAYERS]u8 = @splat(0),
    tiles: u8 = 0,
    last_slot: u8 = NONE8,
    pennants: u8 = 0,
    ncells: u8 = 0,
    cells: [MAX_CELLS]engine.Cell = undefined,
    ncities: u8 = 0,
    cities: [MAX_CITIES]u16 = undefined,
    /// Cloister/garden position.
    x: i16 = 0,
    y: i16 = 0,
    p_complete: f32 = 0,
    done: bool = false,
};

/// Unseen tiles (draw pile + tile in hand), as counts.
pub const Unseen = struct {
    counts: [tiles.count]u8 = @splat(0),
    total: u32 = 0,
    /// Base tile types with count > 0.
    types: [tiles.count]tiles.TileIndex = undefined,
    ntypes: u8 = 0,
    /// Unseen tiles with a cloister or garden.
    monastic: u32 = 0,

    pub fn of(g: *const Game) Unseen {
        var u: Unseen = .{};
        for (g.remainingDeck()) |t| u.counts[t] += 1;
        if (g.status == .playing) u.counts[g.current_tile] += 1;
        for (u.counts, 0..) |c, t| {
            if (c == 0) continue;
            u.total += c;
            if (tiles.isRiver(@intCast(t))) continue;
            u.types[u.ntypes] = @intCast(t);
            u.ntypes += 1;
            for (tiles.all[t].features) |f| {
                if (f.kind == .cloister or (f.kind == .garden and g.ruleset.abbot)) {
                    u.monastic += c;
                    break;
                }
            }
        }
        return u;
    }
};

const FitMemo = struct {
    keys: [128]u32 = undefined,
    vals: [128]u16 = undefined,
    n: usize = 0,
};

fn fitCount(g: *const Game, u: *const Unseen, memo: *FitMemo, x: i16, y: i16) u32 {
    const key = movegen.CellSet.key(x, y);
    for (memo.keys[0..memo.n], 0..) |k, i| {
        if (k == key) return memo.vals[i];
    }
    const need = movegen.cellNeeds(g, x, y);
    var k: u32 = 0;
    var river = false;
    for (need) |e| {
        if (e == .river) river = true;
    }
    if (!river) {
        for (u.types[0..u.ntypes]) |t| {
            for (0..4) |ri| {
                const r: u2 = @intCast(ri);
                if (movegen.canon_rot[t][r] != r) continue;
                if (movegen.rotFits(t, r, need)) {
                    k += u.counts[t];
                    break;
                }
            }
        }
    }
    if (memo.n < memo.keys.len) {
        memo.keys[memo.n] = key;
        memo.vals[memo.n] = @intCast(k);
        memo.n += 1;
    }
    return k;
}

/// Chance that a cell gets a fitting tile within `draws` attempts.
inline fn hitChance(k: u32, total: u32, draws: f32) f32 {
    if (k == 0 or total == 0 or draws <= 0) return 0;
    const miss = 1.0 - @as(f32, @floatFromInt(k)) / @as(f32, @floatFromInt(total));
    if (miss <= 0) return 1;
    return 1.0 - std.math.pow(f32, miss, draws);
}

/// Turns left for each player, counting the tile in hand for the current player.
pub fn turnsLeft(g: *const Game, total: u32) [MAX_PLAYERS]f32 {
    var out: [MAX_PLAYERS]f32 = @splat(0);
    const np: u32 = g.num_players;
    for (0..np) |p| {
        const off = (@as(u32, @intCast(p)) + np - g.current_player) % np;
        const t = total / np + @intFromBool(off < total % np);
        out[p] = @floatFromInt(t);
    }
    return out;
}

const Analysis = struct {
    entries: [MAX_ENTRIES]Entry = undefined,
    n: usize = 0,
    map: [engine.MAX_NODES]u8 = @splat(NONE8),

    fn add(self: *Analysis, root: u16, kind: FeatureKind) ?*Entry {
        if (self.map[root] != NONE8) return &self.entries[self.map[root]];
        if (self.n >= MAX_ENTRIES) return null;
        self.entries[self.n] = .{ .root = root, .kind = kind };
        self.map[root] = @intCast(self.n);
        self.n += 1;
        return &self.entries[self.n - 1];
    }
};

fn addCell(e: *Entry, x: i16, y: i16) void {
    for (e.cells[0..e.ncells]) |c| {
        if (c.x == x and c.y == y) return;
    }
    if (e.ncells < MAX_CELLS) {
        e.cells[e.ncells] = .{ .x = x, .y = y };
        e.ncells += 1;
    }
}

/// Evaluate a state: estimated final score of every player.
pub fn evaluate(g: *const Game, params: *const Params) Values {
    var v: Values = @splat(0);
    for (0..g.num_players) |p| v[p] = @floatFromInt(g.scores[p]);
    if (g.status == .ended) return v;

    const u = Unseen.of(g);
    const turns = turnsLeft(g, u.total);
    const total_f: f32 = @floatFromInt(u.total);
    const time_frac = @min(1.0, total_f / 72.0);

    var an: Analysis = .{};
    // Figures.
    for (0..g.num_players) |p| {
        for (g.figures[p]) |fs| {
            if (!fs.on_board) continue;
            const root = g.findConst(Game.node(fs.slot, fs.feature));
            const kind = tiles.all[g.placed[fs.slot].tile].features[fs.feature].kind;
            const e = an.add(root, kind) orelse continue;
            e.counts[p] += 1;
            if (kind == .cloister or kind == .garden) {
                e.x = g.placed[fs.slot].x;
                e.y = g.placed[fs.slot].y;
            }
        }
    }
    if (an.n == 0) return addEconomy(g, &u, turns, &an, params, v);

    // One pass over every node: tile counts, open cells, field-adjacent cities.
    var roots: [engine.MAX_NODES]u16 = undefined;
    const has_fields = blk: {
        for (an.entries[0..an.n]) |e| {
            if (e.kind == .field) break :blk true;
        }
        break :blk false;
    };
    for (0..g.placed_len) |si| {
        const slot: u8 = @intCast(si);
        const pl = g.placed[slot];
        const d = tiles.all[pl.tile];
        for (d.features, 0..) |f, fi| {
            const nd = Game.node(slot, @intCast(fi));
            const root = g.findConst(nd);
            roots[nd] = root;
            if (f.kind != .field or !has_fields) continue;
            const ei = an.map[root];
            if (ei == NONE8 or f.adjacent_cities.len == 0) continue;
            for (f.adjacent_cities) |ci| {
                const croot = g.findConst(Game.node(slot, ci));
                const e = &an.entries[ei];
                if (std.mem.indexOfScalar(u16, e.cities[0..e.ncities], croot) == null and e.ncities < MAX_CITIES) {
                    e.cities[e.ncities] = croot;
                    e.ncities += 1;
                }
            }
        }
    }
    // Incomplete cities next to farmed fields get analysed too.
    if (has_fields) {
        const n0 = an.n;
        for (an.entries[0..n0]) |e| {
            if (e.kind != .field) continue;
            for (e.cities[0..e.ncities]) |c| {
                if (g.open[c] != 0) _ = an.add(c, .city);
            }
        }
    }
    for (0..g.placed_len) |si| {
        const slot: u8 = @intCast(si);
        const pl = g.placed[slot];
        const d = tiles.all[pl.tile];
        const rr = &tiles.rotated[pl.tile][pl.rot];
        for (d.features, 0..) |f, fi| {
            const nd = Game.node(slot, @intCast(fi));
            const ei = an.map[roots[nd]];
            if (ei == NONE8) continue;
            const e = &an.entries[ei];
            if (e.last_slot != slot) {
                e.last_slot = slot;
                e.tiles += 1;
            }
            if (f.kind == .road or f.kind == .city) {
                for (0..4) |s| {
                    if (rr.feature_sides[fi] & (@as(u4, 1) << @intCast(s)) == 0) continue;
                    const nx = pl.x + movegen.dx[s];
                    const ny = pl.y + movegen.dy[s];
                    if (g.slotAt(nx, ny) == null) addCell(e, nx, ny);
                }
            }
        }
    }

    var memo: FitMemo = .{};
    // Roads and cities first (fields read city completion chances).
    for (an.entries[0..an.n]) |*e| {
        if (e.kind != .road and e.kind != .city) continue;
        var draws: f32 = 0;
        var holders: u32 = 0;
        for (0..g.num_players) |p| {
            if (e.counts[p] > 0) {
                draws += turns[p];
                holders += 1;
            }
        }
        if (holders == 0) {
            // Unclaimed city seen through a field: assume an average effort.
            draws = total_f / @as(f32, @floatFromInt(g.num_players));
        }
        draws *= params.own_turns;
        if (e.ncells > 1) draws /= @sqrt(@as(f32, @floatFromInt(e.ncells)));
        var p: f32 = if (e.ncells == 0) 0 else 1;
        for (e.cells[0..e.ncells]) |c| {
            p *= hitChance(fitCount(g, &u, &memo, c.x, c.y), u.total, draws);
            if (p == 0) break;
        }
        if (e.ncells > 1) {
            const branch = if (e.kind == .city) params.city_branch else params.road_branch;
            p *= std.math.pow(f32, branch, @floatFromInt(e.ncells - 1));
        }
        e.p_complete = p;
    }

    for (an.entries[0..an.n]) |*e| {
        var winners: u8 = 0;
        var best: u8 = 0;
        for (0..g.num_players) |p| best = @max(best, e.counts[p]);
        if (best == 0) continue;
        for (0..g.num_players) |p| {
            if (e.counts[p] == best) winners |= @as(u8, 1) << @intCast(p);
        }
        const tiles_f: f32 = @floatFromInt(e.tiles);
        const cells_f: f32 = @floatFromInt(e.ncells);
        const value: f32 = switch (e.kind) {
            .road => blk: {
                const vc = tiles_f + cells_f;
                break :blk e.p_complete * vc + (1 - e.p_complete) * tiles_f;
            },
            .city => blk: {
                const pen: f32 = @floatFromInt(g.pennants[e.root]);
                var vc = 2 * (tiles_f + cells_f) + 2 * pen;
                if (g.ruleset.field_edition <= 2 and e.tiles + e.ncells == 2) vc = 2;
                const vi = tiles_f + pen;
                break :blk e.p_complete * vc + (1 - e.p_complete) * vi;
            },
            .cloister, .garden => blk: {
                var filled: f32 = 1;
                var expect_more: f32 = 0;
                var empty: f32 = 0;
                var oy: i16 = -1;
                while (oy <= 1) : (oy += 1) {
                    var ox: i16 = -1;
                    while (ox <= 1) : (ox += 1) {
                        if (ox == 0 and oy == 0) continue;
                        if (g.slotAt(e.x + ox, e.y + oy) != null) filled += 1 else empty += 1;
                    }
                }
                if (empty > 0) {
                    var draws: f32 = 0;
                    for (0..g.num_players) |p| {
                        if (e.counts[p] > 0) draws += turns[p];
                    }
                    draws = draws * params.own_turns / @sqrt(empty) + params.incidental * total_f;
                    oy = -1;
                    var all_fill: f32 = 1;
                    while (oy <= 1) : (oy += 1) {
                        var ox: i16 = -1;
                        while (ox <= 1) : (ox += 1) {
                            if (ox == 0 and oy == 0) continue;
                            const cx = e.x + ox;
                            const cy = e.y + oy;
                            if (g.slotAt(cx, cy) != null) continue;
                            const q = if (g.neighbourCount(cx, cy) > 0)
                                hitChance(fitCount(g, &u, &memo, cx, cy), u.total, draws)
                            else
                                0.7 * hitChance(u.total, u.total + 8, draws);
                            expect_more += q;
                            all_fill *= q;
                        }
                    }
                    e.p_complete = all_fill;
                } else e.p_complete = 1;
                break :blk filled + expect_more;
            },
            .field => blk: {
                var pts: f32 = 0;
                for (e.cities[0..e.ncities]) |c| {
                    if (g.open[c] == 0) {
                        pts += 1;
                    } else if (an.map[c] != NONE8) {
                        pts += an.entries[an.map[c]].p_complete;
                    }
                }
                const per_city: f32 = if (g.ruleset.field_edition == 1) 4.0 else params.farm_city_points;
                break :blk per_city * pts + params.field_growth * time_frac;
            },
            else => 0,
        };
        for (0..g.num_players) |p| {
            if (winners & (@as(u8, 1) << @intCast(p)) != 0) v[p] += value;
        }
    }
    return addEconomy(g, &u, turns, &an, params, v);
}

fn supplyWorth(eff: f32, turns: f32, params: *const Params) f32 {
    var total: f32 = 0;
    var i: f32 = 0;
    while (i < eff) : (i += 1) {
        const w = std.math.clamp((turns - i * params.meeple_spacing) / params.meeple_horizon, 0, 1);
        if (w <= 0) break;
        total += w * @min(1.0, eff - i);
    }
    return params.meeple_value * total;
}

fn addEconomy(g: *const Game, u: *const Unseen, turns: [MAX_PLAYERS]f32, an: *const Analysis, params: *const Params, v_in: Values) Values {
    var v = v_in;
    for (0..g.num_players) |p| {
        var eff: f32 = @floatFromInt(g.meeplesInSupply(@intCast(p)));
        for (g.figures[p][0..engine.MEEPLES_PER_PLAYER]) |fs| {
            if (!fs.on_board) continue;
            const root = g.findConst(Game.node(fs.slot, fs.feature));
            const ei = an.map[root];
            if (ei == NONE8) continue;
            const e = &an.entries[ei];
            if (e.kind == .field) continue;
            eff += params.return_credit * e.p_complete;
        }
        // Meeples come back late, so they are only worth the turns after that.
        v[p] += supplyWorth(eff, turns[p], params);
        if (g.abbotAvailable(@intCast(p)) and u.total > 0) {
            v[p] += params.abbot_value * hitChance(u.monastic, u.total, turns[p]);
        }
    }
    return v;
}

/// Objective for `me`: own value minus the best opponent's.
pub fn margin(v: Values, n: u8, me: u8) f32 {
    var best: f32 = -std.math.inf(f32);
    for (0..n) |p| {
        if (p != me) best = @max(best, v[p]);
    }
    return v[me] - best;
}

test "evaluate: start position is symmetric-ish and finite" {
    var g = try Game.init(std.testing.allocator, .{}, 1, 2);
    const v = evaluate(&g, &default_params);
    try std.testing.expect(std.math.isFinite(v[0]) and std.math.isFinite(v[1]));
}
