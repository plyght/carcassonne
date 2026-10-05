//! Property tests and a random-playout soak.
const std = @import("std");
const engine = @import("engine.zig");
const tiles = @import("tiles.zig");
const json = @import("json.zig");
const Rng = @import("rng.zig").Rng;

const Game = engine.Game;
const expect = std.testing.expect;
const expectEqual = std.testing.expectEqual;

/// Pinned result of `firstChoiceGame`; the WASM tests in packages/core-wasm
/// check the same constant, so native and WASM agree bit-for-bit.
pub const FIRST_CHOICE_SEED: u64 = 0x5eed_c0ffee;
pub const FIRST_CHOICE_PLAYERS: u8 = 3;
pub const FIRST_CHOICE_HASH: u64 = 0xf33b6098a57029b3;

fn randomMove(g: *const Game, rng: *Rng) ?engine.Move {
    var pbuf: [engine.MAX_PLACEMENTS]engine.Placement = undefined;
    const ps = g.legalPlacements(&pbuf);
    if (ps.len == 0) return null;
    const p = ps[@intCast(rng.below(ps.len))];
    var m: engine.Move = .{ .x = p.x, .y = p.y, .rot = p.rot };
    var fbuf: [2 * engine.MAX_FEATURES]engine.FigureOption = undefined;
    const opts = g.legalFigures(p.x, p.y, p.rot, &fbuf);
    const roll = rng.below(10);
    const ab = g.figures[g.current_player][engine.ABBOT_SLOT];
    if (roll == 0 and ab.on_board) {
        const c = g.placed[ab.slot];
        m.figure = .{ .recall_abbot = .{ .x = c.x, .y = c.y } };
    } else if (roll < 6 and opts.len > 0) {
        const o = opts[@intCast(rng.below(opts.len))];
        m.figure = if (o.kind == .meeple) .{ .meeple = o.feature } else .{ .abbot = o.feature };
    }
    return m;
}

const Tracker = struct {
    on_board: i32 = 0,
    discards: u32 = 0,
    prev_scores: [engine.MAX_PLAYERS]u32 = @splat(0),

    fn observe(self: *Tracker, events: []const engine.Event) void {
        for (events) |e| switch (e) {
            .figure_placed => self.on_board += 1,
            .feature_scored => |s| self.on_board -= @intCast(s.returned.len),
            .abbot_recalled => self.on_board -= 1,
            .tile_discarded => self.discards += 1,
            else => {},
        };
    }
};

fn checkInvariants(g: *Game, t: *Tracker) !void {
    var on_board: i32 = 0;
    for (0..g.num_players) |p| {
        var sum: u32 = 0;
        for (g.breakdown[p]) |b| sum += b;
        try expectEqual(g.scores[p], sum);
        // Scores never go down.
        try expect(g.scores[p] >= t.prev_scores[p]);
        t.prev_scores[p] = g.scores[p];
        for (g.figures[p], 0..) |fs, i| {
            if (!fs.on_board) continue;
            on_board += 1;
            const kind = tiles.def(g.placed[fs.slot].tile).features[fs.feature].kind;
            if (i == engine.ABBOT_SLOT) {
                try expect(kind == .cloister or kind == .garden);
            } else {
                try expect(kind != .garden and kind != .river);
            }
            // Completed roads and cities never keep figures.
            if (kind == .road or kind == .city) {
                const root = g.find(Game.node(fs.slot, fs.feature));
                try expect(g.open[root] != 0);
            }
            if (kind == .cloister or kind == .garden) {
                const c = g.placed[fs.slot];
                try expect(g.neighbourCount(c.x, c.y) < 8);
            }
        }
    }
    // Figure conservation: board figures match the event log.
    try expectEqual(t.on_board, on_board);
    // Tile conservation: every drawn tile is on the board, discarded or in hand.
    const in_hand: u32 = if (g.status == .playing) 1 else 0;
    try expectEqual(@as(u32, g.deck_pos) + 1, @as(u32, g.placed_len) + t.discards + in_hand);
}

fn playRandom(seed: u64, ruleset: engine.Ruleset, players: u8, check_all_placements: bool) !u64 {
    const gpa = std.testing.allocator;
    var g = try Game.init(gpa, ruleset, seed, players);
    var rng = Rng.init(seed ^ 0xa5a5);
    var events = engine.Events.init(gpa);
    defer events.deinit();
    var out: std.ArrayList(u8) = .empty;
    defer out.deinit(gpa);
    var t = Tracker{};
    var turns: u32 = 0;
    while (g.status == .playing) : (turns += 1) {
        try expect(turns < 200);
        if (check_all_placements) {
            // Every legal placement applies (without a figure).
            var pbuf: [engine.MAX_PLACEMENTS]engine.Placement = undefined;
            for (g.legalPlacements(&pbuf)) |p| {
                var copy = g;
                try copy.apply(.{ .x = p.x, .y = p.y, .rot = p.rot }, null);
            }
        }
        const m = randomMove(&g, &rng).?;
        events.clear();
        g.apply(m, &events) catch |err| {
            // Only a recall can be refused (e.g. the cloister got surrounded).
            try expect(m.figure == .recall_abbot);
            try expectEqual(error.IllegalFigure, err);
            continue;
        };
        t.observe(events.items());
        try checkInvariants(&g, &t);
        // JSON encoding never fails.
        out.clearRetainingCapacity();
        const w = json.Writer{ .out = &out, .gpa = gpa };
        try json.writeApplyOk(w, events.items());
        if (g.ply % 17 == 0) {
            // Snapshot -> restore -> continue from the restored copy.
            out.clearRetainingCapacity();
            try json.writeSnapshot(w, &g);
            const r = try json.parseSnapshot(gpa, out.items);
            try expectEqual(g.hash(), r.hash());
            g = r;
        }
    }
    try expect(events.items()[events.items().len - 1] == .game_ended);
    for (0..players) |p| {
        try expectEqual(@as(u8, engine.MEEPLES_PER_PLAYER), g.meeplesInSupply(@intCast(p)));
        try expect(!g.figures[p][engine.ABBOT_SLOT].on_board);
    }
    try expectEqual(@as(i32, 0), t.on_board);
    return g.hash();
}

test "soak: 1000 seeded random games finish cleanly" {
    var seed: u64 = 1;
    while (seed <= 1000) : (seed += 1) {
        const ruleset: engine.Ruleset = .{
            .field_edition = @intCast(1 + seed % 3),
            .river = seed % 4 != 0,
            .abbot = seed % 5 != 0,
        };
        const players: u8 = @intCast(2 + seed % 4);
        _ = try playRandom(seed, ruleset, players, seed <= 20);
    }
}

test "determinism: same seed and moves give the same hash" {
    const a = try playRandom(77, .{}, 4, false);
    const b = try playRandom(77, .{}, 4, false);
    try expectEqual(a, b);
    const c = try playRandom(78, .{}, 4, false);
    try expect(a != c);
}

/// Deterministic policy shared with the WASM test: first legal placement, then
/// the first figure option (or none).
pub fn firstChoiceGame(seed: u64, players: u8) !Game {
    var g = try Game.init(std.heap.page_allocator, .{}, seed, players);
    while (g.status == .playing) {
        var pbuf: [engine.MAX_PLACEMENTS]engine.Placement = undefined;
        const p = g.legalPlacements(&pbuf)[0];
        var fbuf: [2 * engine.MAX_FEATURES]engine.FigureOption = undefined;
        const opts = g.legalFigures(p.x, p.y, p.rot, &fbuf);
        var m: engine.Move = .{ .x = p.x, .y = p.y, .rot = p.rot };
        if (opts.len > 0) m.figure = if (opts[0].kind == .meeple) .{ .meeple = opts[0].feature } else .{ .abbot = opts[0].feature };
        try g.apply(m, null);
    }
    return g;
}

test "known constant: first-choice game hash (cross-checked by core-wasm)" {
    const g = try firstChoiceGame(FIRST_CHOICE_SEED, FIRST_CHOICE_PLAYERS);
    if (FIRST_CHOICE_HASH == 0) std.debug.print("first-choice hash: 0x{x:0>16} scores {any}\n", .{ g.hash(), g.scores[0..3] });
    try expectEqual(FIRST_CHOICE_HASH, g.hash());
}

test "clone is independent" {
    var g = try Game.init(std.testing.allocator, .{}, 3, 2);
    const h = g.hash();
    var c = g;
    var pbuf: [engine.MAX_PLACEMENTS]engine.Placement = undefined;
    const p = c.legalPlacements(&pbuf)[0];
    try c.apply(.{ .x = p.x, .y = p.y, .rot = p.rot }, null);
    try expectEqual(h, g.hash());
    try expect(c.hash() != h);
}
