//! AI tests: every returned move is legal, decisions are deterministic.
const std = @import("std");
const engine = @import("../engine/engine.zig");
const ai = @import("ai.zig");
const Rng = @import("../engine/rng.zig").Rng;

const Game = engine.Game;
const testing = std.testing;

fn randomStep(g: *Game, rng: *Rng) !void {
    var buf: [ai.movegen.MAX_MOVES]engine.Move = undefined;
    const ms = ai.movegen.generate(g, &buf);
    try g.apply(ms[@intCast(rng.below(ms.len))], null);
}

test "every tier returns a legal move across many random states" {
    const gpa = testing.allocator;
    var rng = Rng.init(2024);
    var seed: u64 = 1;
    while (seed <= 12) : (seed += 1) {
        const ruleset: engine.Ruleset = .{
            .field_edition = @intCast(1 + seed % 3),
            .river = seed % 3 != 0,
            .abbot = seed % 4 != 0,
        };
        const players: u8 = @intCast(2 + seed % 3);
        var g = try Game.init(gpa, ruleset, seed, players);
        var turn: u32 = 0;
        while (g.status == .playing) : (turn += 1) {
            // Sample states along a random game; ask every tier on some of them.
            if (turn % 5 == seed % 5) {
                inline for (.{ ai.Tier.easy, ai.Tier.medium, ai.Tier.hard, ai.Tier.expert }) |tier| {
                    const m = (try ai.choose(gpa, &g, .{ .tier = tier, .seed = seed * 31 + turn, .iterations = 12 })).?;
                    var copy = g;
                    try copy.apply(m, null);
                }
            }
            try randomStep(&g, &rng);
        }
        try testing.expect((try ai.choose(gpa, &g, .{ .tier = .hard })) == null);
    }
}

test "abbot actions: recall and abbot placement are offered and legal" {
    const gpa = testing.allocator;
    var rng = Rng.init(5);
    var seen_recall = false;
    var seen_abbot = false;
    var seed: u64 = 100;
    while (seed < 140 and !(seen_recall and seen_abbot)) : (seed += 1) {
        var g = try Game.init(gpa, .{}, seed, 2);
        while (g.status == .playing) {
            var buf: [ai.movegen.MAX_MOVES]engine.Move = undefined;
            const ms = ai.movegen.generate(&g, &buf);
            for (ms) |m| {
                switch (m.figure) {
                    .recall_abbot => seen_recall = true,
                    .abbot => seen_abbot = true,
                    else => {},
                }
            }
            // Prefer abbot moves so recalls show up.
            var pick = ms[@intCast(rng.below(ms.len))];
            for (ms) |m| {
                if (m.figure == .abbot) pick = m;
            }
            try g.apply(pick, null);
        }
    }
    try testing.expect(seen_recall and seen_abbot);
}

test "decisions are deterministic given the seed" {
    const gpa = testing.allocator;
    var rng = Rng.init(77);
    var g = try Game.init(gpa, .{}, 4242, 3);
    for (0..25) |_| try randomStep(&g, &rng);
    inline for (.{ ai.Tier.easy, ai.Tier.medium, ai.Tier.hard, ai.Tier.expert }) |tier| {
        const a = (try ai.choose(gpa, &g, .{ .tier = tier, .seed = 9, .iterations = 40 })).?;
        const b = (try ai.choose(gpa, &g, .{ .tier = tier, .seed = 9, .iterations = 40 })).?;
        try testing.expectEqualDeep(a, b);
    }
}

test "search does not depend on the hidden draw order" {
    // Two games with identical public state but a different pile order must
    // get the same decision from the same seed.
    const gpa = testing.allocator;
    var rng = Rng.init(3);
    var g = try Game.init(gpa, .{ .river = false }, 11, 2);
    for (0..20) |_| try randomStep(&g, &rng);
    var h = g;
    var shuffle_rng = Rng.init(1234);
    shuffle_rng.shuffle(u8, h.deck[h.deck_pos..h.deck_len]);
    inline for (.{ ai.Tier.medium, ai.Tier.hard }) |tier| {
        const a = (try ai.choose(gpa, &g, .{ .tier = tier, .seed = 5, .iterations = 30 })).?;
        const b = (try ai.choose(gpa, &h, .{ .tier = tier, .seed = 5, .iterations = 30 })).?;
        try testing.expectEqualDeep(a, b);
    }
}

test "a full AI game finishes" {
    const gpa = testing.allocator;
    var g = try Game.init(gpa, .{}, 8, 2);
    var turn: u64 = 0;
    while (g.status == .playing) : (turn += 1) {
        const tier: ai.Tier = if (g.current_player == 0) .medium else .easy;
        const m = (try ai.choose(gpa, &g, .{ .tier = tier, .seed = turn })).?;
        try g.apply(m, null);
    }
    try testing.expect(g.scores[0] + g.scores[1] > 0);
}
