//! Carcassonne bots (PRD §6.10).
//!
//! | Tier   | Approach                                                          |
//! |--------|-------------------------------------------------------------------|
//! | Easy   | Greedy one-ply with noise; grabs features, never places farmers   |
//! | Medium | One-ply over every (deduplicated) move with the heuristic         |
//! |        | evaluation in eval.zig                                            |
//! | Hard   | Determinized MCTS with chance nodes over the next draw (mcts.zig),|
//! |        | progressive widening ordered by the Medium evaluation; opponents  |
//! |        | answer with their best heuristic reply                            |
//! | Expert | Hard searched deeper and wider, with heuristic rollouts in which  |
//! |        | opponents are modelled as Medium players                          |
//!
//! Everything is deterministic given `Options.seed` and the budget: nothing
//! here reads a clock. A millisecond budget is turned into a cap on search
//! work (apply + evaluate calls) with the calibrated `work_per_ms`, which is
//! also what makes the WASM build (no clock on wasm32-freestanding) work.
//!
//! Search never peeks at the draw order: every MCTS iteration reshuffles the
//! unseen tiles (determinization), and the evaluation only uses tile counts.
const std = @import("std");
const engine = @import("../engine/engine.zig");
const tiles = @import("../engine/tiles.zig");
pub const Rng = @import("../engine/rng.zig").Rng;
pub const movegen = @import("movegen.zig");
pub const eval = @import("eval.zig");
pub const mcts = @import("mcts.zig");

const Game = engine.Game;
const Move = engine.Move;
const Params = eval.Params;

pub const Tier = enum(u8) {
    easy = 0,
    medium = 1,
    hard = 2,
    expert = 3,

    pub fn fromInt(v: u32) ?Tier {
        return if (v <= 3) @enumFromInt(v) else null;
    }
};

pub const SearchConfig = mcts.Config;

pub const hard_config: SearchConfig = .{
    .default_iterations = 600,
    .max_depth = 4,
    .rollout_cycles = 0,
    .rollout_samples = 6,
    .opponent_samples = 0,
    .explore = 2.0,
    .widen_base = 4,
    .widen_rate = 0.6,
    .max_children = 12,
};

pub const expert_config: SearchConfig = .{
    .default_iterations = 1500,
    .max_depth = 4,
    .rollout_cycles = 0,
    .rollout_samples = 8,
    .opponent_samples = 0,
    .explore = 2.0,
    .widen_base = 4,
    .widen_rate = 0.6,
    .max_children = 12,
};

/// Calibrated search work (apply + evaluate calls) per millisecond of think
/// time, measured for core.wasm in Bun on one core (see `zig build ai-bench`
/// and packages/core-wasm/test/ai.test.ts). `budget_ms` is turned into a work
/// cap with it, so think time stays near the budget in every game phase while
/// the search stays deterministic (nothing reads a clock).
pub const work_per_ms: f32 = 90.0;

pub const Options = struct {
    tier: Tier = .medium,
    seed: u64 = 0,
    /// Exact MCTS iteration count (Hard/Expert). Overrides `budget_ms`.
    iterations: ?u32 = null,
    /// Think-time cap in ms (Hard/Expert), translated into a work cap via
    /// `work_per_ms`. Without either, the tier's default iterations run.
    budget_ms: ?u32 = null,
    params: *const Params = &eval.default_params,
};

pub fn configFor(tier: Tier) SearchConfig {
    return if (tier == .expert) expert_config else hard_config;
}

/// Iteration count and work cap a search runs with for these options.
pub const Budget = struct { iterations: u32, max_work: ?u64 };

pub fn budgetFor(opts: Options, cfg: SearchConfig) Budget {
    if (opts.iterations) |n| return .{ .iterations = @max(1, n), .max_work = null };
    if (opts.budget_ms) |ms| {
        const work: u64 = @intFromFloat(@as(f32, @floatFromInt(ms)) * work_per_ms);
        return .{ .iterations = std.math.maxInt(u32), .max_work = @max(1, work) };
    }
    return .{ .iterations = cfg.default_iterations, .max_work = null };
}

/// Scratch memory for one decision (big buffers live here, not on the stack).
pub const Workspace = struct {
    moves: [movegen.MAX_MOVES]Move = undefined,
    search_moves: [movegen.MAX_MOVES]Move = undefined,
    heur: [movegen.MAX_MOVES]f32 = undefined,
    vals: [movegen.MAX_MOVES]eval.Values = undefined,
    order: [movegen.MAX_MOVES]u32 = undefined,
    /// Allocator for the search tree.
    gpa: std.mem.Allocator = std.heap.page_allocator,
    /// Statistics of the last Hard/Expert search (for tuning and benches).
    stats: Stats = .{},
};

pub const Stats = struct { iterations: u32 = 0, work: u64 = 0, nodes: usize = 0 };

/// Choose a move for the current player. Returns null only when the game is
/// over. The returned move is always legal.
pub fn choose(gpa: std.mem.Allocator, g: *const Game, opts: Options) error{OutOfMemory}!?Move {
    if (g.status != .playing) return null;
    const ws = try gpa.create(Workspace);
    defer gpa.destroy(ws);
    ws.gpa = gpa;
    return chooseWith(ws, g, opts);
}

pub fn chooseWith(ws: *Workspace, g: *const Game, opts: Options) ?Move {
    return chooseWithConfig(ws, g, opts, configFor(opts.tier));
}

/// `chooseWith` with an explicit search configuration (for tuning).
pub fn chooseWithConfig(ws: *Workspace, g: *const Game, opts: Options, cfg: SearchConfig) ?Move {
    if (g.status != .playing) return null;
    var rng = Rng.init(opts.seed ^ 0xA1_5EED_0000_0000);
    const moves = movegen.generate(g, &ws.moves);
    if (moves.len == 0) return fallbackMove(g);
    if (moves.len == 1) return moves[0];
    return switch (opts.tier) {
        .easy => easy(g, moves, &rng),
        .medium => moves[medium(g, moves, opts.params, &rng, ws.heur[0..moves.len])],
        .hard, .expert => search(ws, g, opts, cfg, rng) orelse moves[medium(g, moves, opts.params, &rng, ws.heur[0..moves.len])],
    };
}

/// Should never be needed (a drawn tile always has a placement), but keeps the
/// "always return a legal move" promise if movegen and the engine ever disagree.
fn fallbackMove(g: *const Game) ?Move {
    var buf: [engine.MAX_PLACEMENTS]engine.Placement = undefined;
    const ps = g.legalPlacements(&buf);
    if (ps.len == 0) return null;
    return .{ .x = ps[0].x, .y = ps[0].y, .rot = ps[0].rot };
}

inline fn unit(rng: *Rng) f32 {
    return @as(f32, @floatFromInt(rng.next() >> 40)) / @as(f32, 1 << 24);
}

// ---------------------------------------------------------------- Easy

fn featureSize(g: *const Game, slot: u8, f: u8) f32 {
    const root = g.findConst(Game.node(slot, f));
    var n: f32 = 0;
    for (0..g.placed_len) |si| {
        const d = tiles.all[g.placed[si].tile];
        for (0..d.features.len) |fi| {
            if (g.findConst(Game.node(@intCast(si), @intCast(fi))) == root) {
                n += 1;
                break;
            }
        }
    }
    return n;
}

fn easy(g: *const Game, moves: []const Move, rng: *Rng) Move {
    const me = g.current_player;
    var best: usize = 0;
    var best_score: f32 = -std.math.inf(f32);
    for (moves, 0..) |m, i| {
        var score: f32 = 5.0 * unit(rng);
        switch (m.figure) {
            .meeple => |f| {
                const kind = tiles.all[g.current_tile].features[f].kind;
                if (kind == .field) continue; // ignores farmers
                score += 3;
            },
            .abbot => score += 2,
            else => {},
        }
        var c = g.*;
        c.apply(m, null) catch continue;
        score += @floatFromInt(c.scores[me] - g.scores[me]);
        switch (m.figure) {
            .meeple => |f| if (c.figures[me][0..engine.MEEPLES_PER_PLAYER].len > 0) {
                // Bigger features look juicier (when the meeple is still there).
                for (c.figures[me][0..engine.MEEPLES_PER_PLAYER]) |fs| {
                    if (fs.on_board and fs.slot == c.placed_len - 1 and fs.feature == f) {
                        score += 0.5 * featureSize(&c, fs.slot, fs.feature);
                        break;
                    }
                }
            },
            else => {},
        }
        if (score > best_score) {
            best_score = score;
            best = i;
        }
    }
    return moves[best];
}

// ---------------------------------------------------------------- Medium

/// One-ply search. Fills `values` with each move's margin; returns the best index.
fn medium(g: *const Game, moves: []const Move, params: *const Params, rng: *Rng, values: []f32) usize {
    const me = g.current_player;
    var best: usize = 0;
    var best_v: f32 = -std.math.inf(f32);
    for (moves, 0..) |m, i| {
        var c = g.*;
        c.apply(m, null) catch {
            values[i] = -1e9;
            continue;
        };
        const v = eval.margin(eval.evaluate(&c, params), g.num_players, me) + 1e-3 * unit(rng);
        values[i] = v;
        if (v > best_v) {
            best_v = v;
            best = i;
        }
    }
    return best;
}

// ---------------------------------------------------------------- MCTS

/// Hard/Expert. Null only if the tree could not be allocated (the caller then
/// falls back to Medium, so a move is always returned).
fn search(ws: *Workspace, g: *const Game, opts: Options, cfg: SearchConfig, rng: Rng) ?Move {
    var s: mcts.Search = .{
        .gpa = ws.gpa,
        .params = opts.params,
        .cfg = cfg,
        .me = g.current_player,
        .num_players = g.num_players,
        .moves_buf = &ws.search_moves,
        .vals_buf = &ws.vals,
        .order_buf = &ws.order,
        .rng = rng,
    };
    defer s.deinit();
    const b = budgetFor(opts, cfg);
    const m = s.run(g, b.iterations, b.max_work) catch null;
    ws.stats = .{ .iterations = s.iterations, .work = s.work, .nodes = s.nodes.items.len };
    return m;
}

test {
    _ = movegen;
    _ = eval;
    _ = mcts;
    _ = @import("ai_test.zig");
}
