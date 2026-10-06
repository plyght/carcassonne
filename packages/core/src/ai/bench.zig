//! AI tournament harness: `zig build ai-bench -- <tierA> <tierB> [options]`.
//!
//! Plays seeded 1v1 games over `--seeds N` seeds (default 200), each seed twice
//! with the seats swapped, and reports A's win rate (ties count half) plus the
//! mean and max think time per move for each side.
//!
//! Options:
//!   --seeds N           number of seeds (games = 2N)
//!   --first S           first seed (default 1)
//!   --threads T         worker threads (default: CPU count)
//!   --a-iters N / --b-iters N        MCTS iterations per move
//!   --a-ms N / --b-ms N              budget_ms (translated to iterations)
//!   --a-param k=v / --b-param k=v    override an eval.Params field
//!   --a-cfg k=v / --b-cfg k=v        override a SearchConfig field
//!   --ruleset base|river|abbot|full  (default full: river + abbot, 3rd ed. fields)
const std = @import("std");
const core = @import("core");
const engine = core.engine;
const ai = core.ai;

const Side = struct {
    tier: ai.Tier,
    iters: ?u32 = null,
    budget_ms: ?u32 = null,
    params: ai.eval.Params = .{},
    cfg: ?ai.SearchConfig = null,
};

const Stats = struct {
    wins: [2]u32 = .{ 0, 0 },
    ties: u32 = 0,
    games: u32 = 0,
    ns: [2]u64 = .{ 0, 0 },
    moves: [2]u64 = .{ 0, 0 },
    max_ns: [2]u64 = .{ 0, 0 },
    margin: [2]i64 = .{ 0, 0 },
    points: [2]u64 = .{ 0, 0 },
};

fn nowNs() u64 {
    var ts: std.os.linux.timespec = undefined;
    _ = std.os.linux.clock_gettime(.MONOTONIC, &ts);
    return @as(u64, @intCast(ts.sec)) * 1_000_000_000 + @as(u64, @intCast(ts.nsec));
}

var sides: [2]Side = undefined;
var ruleset: engine.Ruleset = .{};
var next_job = std.atomic.Value(u32).init(0);
var n_jobs: u32 = 0;
var first_seed: u64 = 1;
var stats_mutex: std.atomic.Mutex = .unlocked;
var stats: Stats = .{};

fn lock() void {
    while (!stats_mutex.tryLock()) std.atomic.spinLoopHint();
}

fn playGame(seed: u64, a_seat: u8, ws: *ai.Workspace, local: *Stats) void {
    var g = engine.Game.init(std.heap.page_allocator, ruleset, seed, 2) catch unreachable;
    var turn: u64 = 0;
    while (g.status == .playing) : (turn += 1) {
        const seat = g.current_player;
        const side_idx: usize = if (seat == a_seat) 0 else 1;
        const side = &sides[side_idx];
        const t0 = nowNs();
        const m = chooseFor(ws, &g, side, seed *% 1_000_003 +% turn * 7919 +% side_idx);
        const dt = nowNs() - t0;
        local.ns[side_idx] += dt;
        local.moves[side_idx] += 1;
        local.max_ns[side_idx] = @max(local.max_ns[side_idx], dt);
        g.apply(m, null) catch |e| std.debug.panic("illegal AI move {any}: {any}", .{ m, e });
    }
    const sa: i64 = g.scores[a_seat];
    const sb: i64 = g.scores[1 - a_seat];
    local.games += 1;
    local.margin[0] += sa - sb;
    local.points[0] += @intCast(sa);
    local.points[1] += @intCast(sb);
    if (sa > sb) local.wins[0] += 1 else if (sb > sa) local.wins[1] += 1 else local.ties += 1;
}

fn chooseFor(ws: *ai.Workspace, g: *const engine.Game, side: *const Side, seed: u64) engine.Move {
    const opts: ai.Options = .{
        .tier = side.tier,
        .seed = seed,
        .iterations = side.iters,
        .budget_ms = side.budget_ms,
        .params = &side.params,
    };
    if (side.cfg) |cfg| return ai.chooseWithConfig(ws, g, opts, cfg).?;
    return ai.chooseWith(ws, g, opts).?;
}

fn worker() void {
    const ws = std.heap.page_allocator.create(ai.Workspace) catch unreachable;
    defer std.heap.page_allocator.destroy(ws);
    ws.* = .{ .gpa = std.heap.smp_allocator };
    while (true) {
        const job = next_job.fetchAdd(1, .monotonic);
        if (job >= n_jobs) break;
        var local: Stats = .{};
        playGame(first_seed + job / 2, @intCast(job % 2), ws, &local);
        // One line per game so interrupted runs can still be aggregated.
        std.debug.print("game seed={d} a_seat={d} a={d} b={d}\n", .{ first_seed + job / 2, job % 2, local.points[0], local.points[1] });
        lock();
        defer stats_mutex.unlock();
        inline for (0..2) |i| {
            stats.wins[i] += local.wins[i];
            stats.ns[i] += local.ns[i];
            stats.moves[i] += local.moves[i];
            stats.max_ns[i] = @max(stats.max_ns[i], local.max_ns[i]);
            stats.points[i] += local.points[i];
        }
        stats.margin[0] += local.margin[0];
        stats.ties += local.ties;
        stats.games += local.games;
        if (stats.games % 50 == 0) {
            const gf: f64 = @floatFromInt(stats.games);
            std.debug.print("  .. {d} games: A {d:.1}%\n", .{ stats.games, (@as(f64, @floatFromInt(stats.wins[0])) + 0.5 * @as(f64, @floatFromInt(stats.ties))) / gf * 100 });
        }
    }
}

fn parseTier(s: []const u8) ai.Tier {
    inline for (.{ "easy", "medium", "hard", "expert" }, 0..) |name, i| {
        if (std.mem.eql(u8, s, name)) return @enumFromInt(i);
    }
    std.debug.panic("unknown tier {s}", .{s});
}

fn setField(comptime T: type, obj: *T, kv: []const u8) void {
    const eq = std.mem.indexOfScalar(u8, kv, '=') orelse std.debug.panic("expected k=v, got {s}", .{kv});
    const k = kv[0..eq];
    const v = kv[eq + 1 ..];
    inline for (@typeInfo(T).@"struct".field_names, @typeInfo(T).@"struct".field_types) |name, ft| {
        if (std.mem.eql(u8, k, name)) {
            switch (@typeInfo(ft)) {
                .float => @field(obj.*, name) = std.fmt.parseFloat(ft, v) catch unreachable,
                .int => @field(obj.*, name) = std.fmt.parseInt(ft, v, 10) catch unreachable,
                else => {},
            }
            return;
        }
    }
    std.debug.panic("unknown field {s}", .{k});
}

/// `ai-bench profile`: cost of move generation, apply and evaluate.
fn profile() !void {
    var t_apply: u64 = 0;
    var t_eval: u64 = 0;
    var t_gen: u64 = 0;
    var t_draw: u64 = 0;
    var n_apply: u64 = 0;
    var n_gen: u64 = 0;
    var buf: [ai.movegen.MAX_MOVES]engine.Move = undefined;
    var sink: f32 = 0;
    for (1..21) |seed| {
        var g = try engine.Game.init(std.heap.page_allocator, .{}, seed, 2);
        var rng = ai.Rng.init(seed);
        while (g.status == .playing) {
            var t0 = nowNs();
            const ms = ai.movegen.generate(&g, &buf);
            t_gen += nowNs() - t0;
            n_gen += 1;
            for (ms) |m| {
                t0 = nowNs();
                var c = g;
                c.apply(m, null) catch unreachable;
                const t1 = nowNs();
                const v = ai.eval.evaluate(&c, &ai.eval.default_params);
                const t2 = nowNs();
                sink += v[0];
                t_apply += t1 - t0;
                t_eval += t2 - t1;
                n_apply += 1;
                // Next tile's placeability check alone (part of apply).
                const t3 = nowNs();
                sink += @floatFromInt(@intFromBool(c.status == .playing and c.hasPlacement(c.current_tile)));
                t_draw += nowNs() - t3;
            }
            try g.apply(ms[@intCast(rng.below(ms.len))], null);
        }
    }
    std.debug.print("gen {d} ns/call, apply {d} ns (hasPlacement {d} ns), eval {d} ns, moves/turn {d} ({d})\n", .{ t_gen / n_gen, t_apply / n_apply, t_draw / n_apply, t_eval / n_apply, n_apply / n_gen, sink });
}

/// `ai-bench search-profile [ms]`: time Hard searches along a Medium game and
/// print iteration and work counts per move.
fn searchProfile(ms: u32, tier: ai.Tier) !void {
    const ws = try std.heap.page_allocator.create(ai.Workspace);
    ws.* = .{ .gpa = std.heap.smp_allocator };
    for (1..3) |seed| {
        var g = try engine.Game.init(std.heap.page_allocator, .{}, seed, 2);
        while (g.status == .playing) {
            var buf: [ai.movegen.MAX_MOVES]engine.Move = undefined;
            const n_moves = ai.movegen.generate(&g, &buf).len;
            const t0 = nowNs();
            _ = ai.chooseWith(ws, &g, .{ .tier = tier, .seed = g.ply, .budget_ms = ms });
            const dt = (nowNs() - t0) / 1_000_000;
            std.debug.print("seed {d} ply {d}: moves {d}, {d} ms, iterations {d}, work {d}, nodes {d}\n", .{ seed, g.ply, n_moves, dt, ws.stats.iterations, ws.stats.work, ws.stats.nodes });
            try g.apply(ai.chooseWith(ws, &g, .{ .tier = .medium, .seed = g.ply }).?, null);
        }
    }
}

pub fn main(init: std.process.Init) !void {
    var args = init.minimal.args.iterate();
    _ = args.next();
    {
        var peek = init.minimal.args.iterate();
        _ = peek.next();
        if (peek.next()) |a| {
            if (std.mem.eql(u8, a, "profile")) return profile();
            if (std.mem.eql(u8, a, "search-profile")) {
                const ms = if (peek.next()) |v| try std.fmt.parseInt(u32, v, 10) else 1000;
                return searchProfile(ms, if (peek.next()) |v| parseTier(v) else .hard);
            }
        }
    }
    var positional: usize = 0;
    var seeds: u32 = 200;
    var threads: usize = std.Thread.getCpuCount() catch 4;
    sides = .{ .{ .tier = .medium }, .{ .tier = .easy } };
    while (args.next()) |arg| {
        if (std.mem.eql(u8, arg, "--seeds")) {
            seeds = try std.fmt.parseInt(u32, args.next().?, 10);
        } else if (std.mem.eql(u8, arg, "--first")) {
            first_seed = try std.fmt.parseInt(u64, args.next().?, 10);
        } else if (std.mem.eql(u8, arg, "--threads")) {
            threads = try std.fmt.parseInt(usize, args.next().?, 10);
        } else if (std.mem.eql(u8, arg, "--ruleset")) {
            const r = args.next().?;
            ruleset = if (std.mem.eql(u8, r, "base"))
                .{ .river = false, .abbot = false }
            else if (std.mem.eql(u8, r, "river"))
                .{ .abbot = false }
            else if (std.mem.eql(u8, r, "abbot"))
                .{ .river = false }
            else
                .{};
        } else if (arg.len > 4 and arg[0] == '-' and arg[1] == '-' and (arg[2] == 'a' or arg[2] == 'b') and arg[3] == '-') {
            const side = &sides[if (arg[2] == 'a') 0 else 1];
            const what = arg[4..];
            const val = args.next().?;
            if (std.mem.eql(u8, what, "iters")) {
                side.iters = try std.fmt.parseInt(u32, val, 10);
            } else if (std.mem.eql(u8, what, "ms")) {
                side.budget_ms = try std.fmt.parseInt(u32, val, 10);
            } else if (std.mem.eql(u8, what, "param")) {
                setField(ai.eval.Params, &side.params, val);
            } else if (std.mem.eql(u8, what, "cfg")) {
                if (side.cfg == null) side.cfg = ai.configFor(side.tier);
                setField(ai.SearchConfig, &side.cfg.?, val);
            } else std.debug.panic("unknown option {s}", .{arg});
        } else {
            if (positional < 2) sides[positional].tier = parseTier(arg);
            positional += 1;
        }
    }
    n_jobs = seeds * 2;
    const t0 = nowNs();
    var pool: [64]std.Thread = undefined;
    const nt = @min(threads, pool.len);
    for (pool[0..nt]) |*t| t.* = try std.Thread.spawn(.{}, worker, .{});
    for (pool[0..nt]) |t| t.join();
    const wall = @as(f64, @floatFromInt(nowNs() - t0)) / 1e9;

    const games: f64 = @floatFromInt(stats.games);
    const a_rate = (@as(f64, @floatFromInt(stats.wins[0])) + 0.5 * @as(f64, @floatFromInt(stats.ties))) / games;
    // 95% interval (normal approximation).
    const ci = 1.96 * @sqrt(a_rate * (1 - a_rate) / games);
    std.debug.print("{s} vs {s}: {d} games ({d} seeds x 2 seats), A wins {d}, B wins {d}, ties {d}\n", .{
        @tagName(sides[0].tier), @tagName(sides[1].tier), stats.games, seeds, stats.wins[0], stats.wins[1], stats.ties,
    });
    std.debug.print("A win rate {d:.1}% (+/- {d:.1}), mean margin {d:.1}, mean points A {d:.1} B {d:.1}\n", .{
        a_rate * 100, ci * 100, @as(f64, @floatFromInt(stats.margin[0])) / games,
        @as(f64, @floatFromInt(stats.points[0])) / games, @as(f64, @floatFromInt(stats.points[1])) / games,
    });
    for (0..2) |i| {
        const mean_ms = @as(f64, @floatFromInt(stats.ns[i])) / @as(f64, @floatFromInt(@max(1, stats.moves[i]))) / 1e6;
        const max_ms = @as(f64, @floatFromInt(stats.max_ns[i])) / 1e6;
        std.debug.print("  {s} ({s}): mean {d:.2} ms/move, max {d:.2} ms\n", .{ if (i == 0) "A" else "B", @tagName(sides[i].tier), mean_ms, max_ms });
    }
    std.debug.print("wall {d:.1}s on {d} threads\n", .{ wall, nt });
}
