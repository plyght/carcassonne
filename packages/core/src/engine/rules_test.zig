//! One test per rule, with hand-placed fixtures. "Rulebook" references are to
//! the 3rd-edition base game rules as transcribed on WikiCarpedia "Base game"
//! (Examples 1a-5b), "The Abbot", "River" and "The Farmers" pages.
const std = @import("std");
const engine = @import("engine.zig");
const tiles = @import("tiles.zig");
const Fixture = @import("fixture.zig").Fixture;

const Game = engine.Game;
const Event = engine.Event;
const expect = std.testing.expect;
const expectEqual = std.testing.expectEqual;

const no_river: engine.Ruleset = .{ .river = false };

fn ev() engine.Events {
    return engine.Events.init(std.testing.allocator);
}

fn scored(events: []const Event, n: usize) ?@FieldType(Event, "feature_scored") {
    var i: usize = 0;
    for (events) |e| switch (e) {
        .feature_scored => |s| {
            if (i == n) return s;
            i += 1;
        },
        else => {},
    };
    return null;
}

fn countScored(events: []const Event) usize {
    var n: usize = 0;
    for (events) |e| {
        if (e == .feature_scored) n += 1;
    }
    return n;
}

fn hasFigure(opts: []const engine.FigureOption, kind: engine.FigureKind, feature: u8) bool {
    for (opts) |o| if (o.kind == kind and o.feature == feature) return true;
    return false;
}

// ---------------------------------------------------------------- placement

test "placement: must touch the board and match every edge (rulebook: Placing a tile)" {
    var fx = Fixture.init(no_river, 2);
    fx.put("D", 0, 0, 0); // city N, road W-E
    fx.deck(&.{"U"});
    const g = &fx.game;
    // U turned once has its road W-E: continues D's road.
    try expect(g.canPlace(g.current_tile, 1, 0, 1));
    // Unrotated U shows field to the west, against D's road.
    try expect(!g.canPlace(g.current_tile, 1, 0, 0));
    // Not adjacent / occupied.
    try expect(!g.canPlace(g.current_tile, 5, 5, 1));
    try expect(!g.canPlace(g.current_tile, 0, 0, 1));
    // D's north edge is city; U has no city edge.
    for (0..4) |r| try expect(!g.canPlace(g.current_tile, 0, -1, @intCast(r)));
    try std.testing.expectError(error.IllegalPlacement, g.apply(.{ .x = 1, .y = 0, .rot = 0 }, null));
    // The failed move left the game untouched.
    try expectEqual(@as(u32, 0), g.ply);
    var buf: [engine.MAX_PLACEMENTS]engine.Placement = undefined;
    for (g.legalPlacements(&buf)) |p| try expect(g.canPlace(g.current_tile, p.x, p.y, p.rot));
}

test "unplaceable tile is discarded and another drawn (rulebook: Placing a tile)" {
    var fx = Fixture.init(no_river, 2);
    fx.put("C", 0, 0, 0); // all city: a road tile cannot be placed anywhere
    var e = ev();
    defer e.deinit();
    try fx.deckEvents(&.{ "U", "E" }, &e);
    try expectEqual(@as(usize, 2), e.items().len);
    try expect(e.items()[0] == .tile_discarded);
    try expectEqual(Fixture.tileIndex("U"), e.items()[0].tile_discarded.tile);
    try expect(e.items()[1] == .turn_started);
    try std.testing.expectEqualStrings("E", fx.currentId().?);
}

// ---------------------------------------------------------------- roads

test "road: completed road scores 1 per tile, meeple returns (Example 1d)" {
    var fx = Fixture.init(no_river, 2);
    fx.put("L", 0, 0, 0); // village: road arms E(1), S(2), W(3)
    fx.put("U", 1, 0, 1); // straight road W-E
    fx.meeple(0, 1, 0, 0);
    fx.deck(&.{ "L", "B" });
    const g = &fx.game;
    // The west arm of the new L would join the occupied road: no meeple there (Example 4a).
    var opts_buf: [16]engine.FigureOption = undefined;
    const opts = g.legalFigures(2, 0, 0, &opts_buf);
    try expect(!hasFigure(opts, .meeple, 3));
    try expect(hasFigure(opts, .meeple, 1));
    try expect(hasFigure(opts, .meeple, 2));

    var e = ev();
    defer e.deinit();
    try g.apply(.{ .x = 2, .y = 0, .rot = 0 }, &e);
    const s = scored(e.items(), 0).?;
    try expectEqual(engine.FeatureKind.road, s.kind);
    try expectEqual(@as(u32, 3), s.points);
    try expectEqual(@as(u8, 0b01), s.winners);
    try expectEqual(@as(usize, 3), s.cells.len);
    try expectEqual(@as(usize, 1), s.returned.len);
    try expectEqual(@as(u32, 3), g.scores[0]);
    try expectEqual(@as(u8, 7), g.meeplesInSupply(0));
}

test "road: shared road, tied thieves both score full points (Example 4b)" {
    var fx = Fixture.init(no_river, 2);
    fx.put("L", 0, 0, 0);
    fx.put("U", 1, 0, 1);
    fx.meeple(0, 1, 0, 0);
    fx.put("L", 4, 0, 0);
    fx.put("U", 3, 0, 1);
    fx.meeple(1, 3, 0, 0);
    fx.deck(&.{ "U", "B" });
    try fx.game.apply(.{ .x = 2, .y = 0, .rot = 1 }, null);
    try expectEqual(@as(u32, 5), fx.game.scores[0]);
    try expectEqual(@as(u32, 5), fx.game.scores[1]);
    try expectEqual(@as(u8, 7), fx.game.meeplesInSupply(0));
    try expectEqual(@as(u8, 7), fx.game.meeplesInSupply(1));
}

test "road: a loop is complete" {
    var fx = Fixture.init(no_river, 2);
    fx.put("V", 0, 0, 3); // road S-E
    fx.put("V", 1, 0, 0); // road W-S
    fx.put("V", 1, 1, 1); // road N-W
    fx.meeple(0, 0, 0, 0);
    fx.deck(&.{ "V", "B" });
    try fx.game.apply(.{ .x = 0, .y = 1, .rot = 2 }, null); // road N-E closes the loop
    try expectEqual(@as(u32, 4), fx.game.scores[0]);
    try expectEqual(@as(u32, 4), fx.game.breakdown[0][@intFromEnum(engine.Category.road)]);
}

// ---------------------------------------------------------------- cities

test "city: 2 per tile + 2 per coat of arms (Example 2b, 8 points)" {
    var fx = Fixture.init(no_river, 2);
    fx.put("E", 0, -1, 2); // city facing S
    fx.meeple(0, 0, -1, 0);
    fx.put("F", 0, 0, 1); // city N-S with pennant
    fx.deck(&.{ "E", "B" });
    var e = ev();
    defer e.deinit();
    try fx.game.apply(.{ .x = 0, .y = 1, .rot = 0 }, &e);
    const s = scored(e.items(), 0).?;
    try expectEqual(engine.FeatureKind.city, s.kind);
    try expectEqual(@as(u32, 8), s.points);
    try expectEqual(@as(u32, 8), fx.game.scores[0]);
}

test "city: majority takes all, extra knights do not multiply (Example 5b, 10 points)" {
    var fx = Fixture.init(no_river, 2);
    fx.put("E", -1, 0, 1); // city facing E
    fx.put("F", 0, 0, 0); // city W-E, pennant
    fx.put("G", 1, 0, 0); // city W-E
    fx.meeple(0, -1, 0, 0);
    fx.meeple(0, 1, 0, 0);
    fx.meeple(1, 0, 0, 0);
    fx.currentPlayer(1);
    fx.deck(&.{ "E", "B" });
    try fx.game.apply(.{ .x = 2, .y = 0, .rot = 3 }, null); // city facing W closes it
    try expectEqual(@as(u32, 10), fx.game.scores[0]);
    try expectEqual(@as(u32, 0), fx.game.scores[1]);
    try expectEqual(@as(u8, 7), fx.game.meeplesInSupply(0));
    try expectEqual(@as(u8, 7), fx.game.meeplesInSupply(1));
}

fn smallCity(edition: u8) !u32 {
    var fx = Fixture.init(.{ .river = false, .field_edition = edition }, 2);
    fx.put("E", 0, 0, 0);
    fx.deck(&.{ "E", "B" });
    // Placing a meeple on the city that this tile completes: scored and returned at once.
    try fx.game.apply(.{ .x = 0, .y = -1, .rot = 2, .figure = .{ .meeple = 0 } }, null);
    try expectEqual(@as(u8, 7), fx.game.meeplesInSupply(0));
    return fx.game.scores[0];
}

test "city: 2-tile city scores 4 (3rd ed.) or 2 (1st/2nd ed. rules)" {
    try expectEqual(@as(u32, 4), try smallCity(3));
    try expectEqual(@as(u32, 2), try smallCity(2));
    try expectEqual(@as(u32, 2), try smallCity(1));
}

test "city: incomplete at game end scores 1 per tile + 1 per coat of arms (final scoring, 3 points)" {
    var fx = Fixture.init(no_river, 2);
    fx.put("M", 0, 0, 0); // city N+W with pennant
    fx.put("E", -1, 0, 1); // city facing E joins it
    fx.meeple(0, 0, 0, 0);
    fx.deck(&.{"B"});
    var e = ev();
    defer e.deinit();
    try fx.game.apply(.{ .x = 0, .y = 1, .rot = 0 }, &e);
    const s = scored(e.items(), 0).?;
    try expect(s.final);
    try expectEqual(@as(u32, 3), s.points);
    try expectEqual(@as(u32, 3), fx.game.scores[0]);
    try expect(e.items()[e.items().len - 1] == .game_ended);
    try expectEqual(engine.Status.ended, fx.game.status);
    try std.testing.expectError(error.GameOver, fx.game.apply(.{ .x = 5, .y = 5, .rot = 0 }, null));
}

// ---------------------------------------------------------------- cloisters

test "cloister: surrounded scores 9 and the monk returns (Example 3b)" {
    var fx = Fixture.init(no_river, 2);
    fx.put("B", 0, 0, 0);
    fx.meeple(0, 0, 0, 0);
    const ring = [_][2]i16{ .{ -1, -1 }, .{ 0, -1 }, .{ 1, -1 }, .{ -1, 0 }, .{ 1, 0 }, .{ -1, 1 }, .{ 0, 1 } };
    for (ring) |c| fx.put("B", c[0], c[1], 0);
    fx.deck(&.{ "B", "B" });
    var e = ev();
    defer e.deinit();
    try fx.game.apply(.{ .x = 1, .y = 1, .rot = 0 }, &e);
    try expectEqual(@as(usize, 1), countScored(e.items()));
    const s = scored(e.items(), 0).?;
    try expectEqual(engine.FeatureKind.cloister, s.kind);
    try expectEqual(@as(u32, 9), s.points);
    try expectEqual(@as(usize, 9), s.cells.len);
    try expectEqual(@as(u32, 9), fx.game.scores[0]);
    try expectEqual(@as(u8, 7), fx.game.meeplesInSupply(0));
}

test "cloister: incomplete at end scores 1 + neighbours (final scoring, 4 points)" {
    var fx = Fixture.init(no_river, 2);
    fx.put("B", 0, 0, 0);
    fx.meeple(0, 0, 0, 0);
    fx.put("B", 1, 0, 0);
    fx.put("B", 0, 1, 0);
    fx.deck(&.{"B"});
    try fx.game.apply(.{ .x = -1, .y = 0, .rot = 0 }, null);
    try expectEqual(@as(u32, 4), fx.game.scores[0]);
}

// ---------------------------------------------------------------- farmers

test "farmers stay on the board when other features score" {
    var fx = Fixture.init(no_river, 2);
    fx.put("E", 0, 0, 0);
    fx.meeple(0, 0, 0, 1); // farmer
    fx.deck(&.{ "E", "B" });
    try fx.game.apply(.{ .x = 0, .y = -1, .rot = 2 }, null); // completes the city
    try expectEqual(@as(u8, 6), fx.game.meeplesInSupply(0));
}

fn fieldTwoCities(edition: u8) !u32 {
    var fx = Fixture.init(.{ .river = false, .field_edition = edition }, 2);
    fx.put("H", 0, 0, 0); // cities N and S, field between
    fx.put("E", 0, -1, 2);
    fx.put("E", 0, 1, 0);
    fx.meeple(0, 0, 0, 2);
    fx.deck(&.{"B"});
    try fx.game.apply(.{ .x = 1, .y = 0, .rot = 0 }, null);
    return fx.game.breakdown[0][@intFromEnum(engine.Category.field)];
}

test "fields: 3 per completed city (3rd/2nd ed.), 4 per city (1st ed.)" {
    try expectEqual(@as(u32, 6), try fieldTwoCities(3));
    try expectEqual(@as(u32, 6), try fieldTwoCities(2));
    try expectEqual(@as(u32, 8), try fieldTwoCities(1));
}

fn twoFieldsOneCity(edition: u8, p1_farmers: u8) ![2]u32 {
    var fx = Fixture.init(.{ .river = false, .field_edition = edition }, 2);
    fx.put("E", 0, 0, 0); // field A below the city
    fx.put("E", 0, -1, 2); // field B above: both touch the same completed city
    if (p1_farmers == 0) {
        fx.meeple(0, 0, 0, 1);
        fx.meeple(0, 0, -1, 1);
    } else {
        fx.meeple(0, 0, 0, 1);
        for (0..p1_farmers) |_| fx.meeple(1, 0, -1, 1);
    }
    fx.deck(&.{"B"});
    try fx.game.apply(.{ .x = 1, .y = 0, .rot = 0 }, null);
    const f = @intFromEnum(engine.Category.field);
    // Every figure goes home at the end.
    try expectEqual(@as(u8, 7), fx.game.meeplesInSupply(0));
    try expectEqual(@as(u8, 7), fx.game.meeplesInSupply(1));
    return .{ fx.game.breakdown[0][f], fx.game.breakdown[1][f] };
}

test "fields: 3rd ed. scores a city once per field; 2nd ed. once per player" {
    try expectEqual([2]u32{ 6, 0 }, try twoFieldsOneCity(3, 0));
    try expectEqual([2]u32{ 3, 0 }, try twoFieldsOneCity(2, 0));
    try expectEqual([2]u32{ 4, 0 }, try twoFieldsOneCity(1, 0));
}

test "fields: 1st ed. majority counts farmers across all fields supplying a city" {
    try expectEqual([2]u32{ 3, 3 }, try twoFieldsOneCity(3, 2));
    try expectEqual([2]u32{ 3, 3 }, try twoFieldsOneCity(2, 2));
    try expectEqual([2]u32{ 0, 4 }, try twoFieldsOneCity(1, 2));
}

test "fields: incomplete cities do not count" {
    var fx = Fixture.init(no_river, 2);
    fx.put("E", 0, 0, 0);
    fx.meeple(0, 0, 0, 1);
    fx.deck(&.{"B"});
    try fx.game.apply(.{ .x = 1, .y = 0, .rot = 0 }, null);
    try expectEqual(@as(u32, 0), fx.game.scores[0]);
}

// ---------------------------------------------------------------- the abbot

test "abbot: only on cloister or garden; meeples never on gardens (The Abbot: Placing a meeple)" {
    var fx = Fixture.init(no_river, 2);
    fx.put("D", 0, 0, 0);
    fx.deck(&.{ "Eg", "B" });
    var buf: [16]engine.FigureOption = undefined;
    // Eg = E plus a garden (feature 2), turned so its city faces south.
    const opts = fx.game.legalFigures(0, 1, 2, &buf);
    try expect(hasFigure(opts, .meeple, 0) or hasFigure(opts, .meeple, 1));
    try expect(hasFigure(opts, .abbot, 2));
    try expect(!hasFigure(opts, .meeple, 2));
    try expect(!hasFigure(opts, .abbot, 0));
    try expect(!hasFigure(opts, .abbot, 1));
    try std.testing.expectError(error.IllegalFigure, fx.game.apply(.{ .x = 0, .y = 1, .rot = 2, .figure = .{ .meeple = 2 } }, null));
    try std.testing.expectError(error.IllegalFigure, fx.game.apply(.{ .x = 0, .y = 1, .rot = 2, .figure = .{ .abbot = 1 } }, null));
    try fx.game.apply(.{ .x = 0, .y = 1, .rot = 2, .figure = .{ .abbot = 2 } }, null);
    try expect(!fx.game.abbotAvailable(0));
}

test "abbot: disabled by the ruleset" {
    var fx = Fixture.init(.{ .river = false, .abbot = false }, 2);
    fx.put("D", 0, 0, 0);
    fx.deck(&.{ "B", "B" });
    var buf: [16]engine.FigureOption = undefined;
    const opts = fx.game.legalFigures(0, 1, 0, &buf);
    try expect(hasFigure(opts, .meeple, 0));
    try expect(!hasFigure(opts, .abbot, 0));
    try std.testing.expectError(error.IllegalFigure, fx.game.apply(.{ .x = 0, .y = 1, .rot = 0, .figure = .{ .abbot = 0 } }, null));
}

test "abbot: recall scores the unfinished cloister immediately (The Abbot example, 6 points)" {
    var fx = Fixture.init(no_river, 2);
    fx.put("B", 0, 0, 0);
    fx.abbot(0, 0, 0, 0);
    fx.put("B", 1, 0, 0);
    fx.put("B", 0, 1, 0);
    fx.put("B", 1, 1, 0);
    fx.put("B", -1, 0, 0);
    fx.deck(&.{ "B", "B", "B" });
    // Wrong cell: illegal.
    try std.testing.expectError(error.IllegalFigure, fx.game.apply(.{ .x = -1, .y = 1, .rot = 0, .figure = .{ .recall_abbot = .{ .x = 1, .y = 0 } } }, null));
    var e = ev();
    defer e.deinit();
    try fx.game.apply(.{ .x = -1, .y = 1, .rot = 0, .figure = .{ .recall_abbot = .{ .x = 0, .y = 0 } } }, &e);
    try expect(e.items()[1] == .abbot_recalled);
    try expectEqual(@as(u32, 6), e.items()[1].abbot_recalled.points);
    try expectEqual(@as(u32, 6), fx.game.breakdown[0][@intFromEnum(engine.Category.cloister)]);
    try expect(fx.game.abbotAvailable(0));
    // Player 1 has no abbot on the board.
    try std.testing.expectError(error.IllegalFigure, fx.game.apply(.{ .x = -1, .y = -1, .rot = 0, .figure = .{ .recall_abbot = .{ .x = 0, .y = 0 } } }, null));
}

test "abbot: recall is not allowed once the cloister is surrounded (Abbot FAQ 11/2020)" {
    var fx = Fixture.init(no_river, 2);
    fx.put("B", 0, 0, 0);
    fx.abbot(0, 0, 0, 0);
    const ring = [_][2]i16{ .{ -1, -1 }, .{ 0, -1 }, .{ 1, -1 }, .{ -1, 0 }, .{ 1, 0 }, .{ -1, 1 }, .{ 0, 1 } };
    for (ring) |c| fx.put("B", c[0], c[1], 0);
    fx.deck(&.{ "B", "B" });
    try std.testing.expectError(error.IllegalFigure, fx.game.apply(.{ .x = 1, .y = 1, .rot = 0, .figure = .{ .recall_abbot = .{ .x = 0, .y = 0 } } }, null));
    // Without the recall the cloister completes normally and the abbot comes home.
    try fx.game.apply(.{ .x = 1, .y = 1, .rot = 0 }, null);
    try expectEqual(@as(u32, 9), fx.game.scores[0]);
    try expect(fx.game.abbotAvailable(0));
}

test "garden: surrounded garden scores 9 to the abbot (garden category)" {
    var fx = Fixture.init(no_river, 2);
    fx.put("Ug", 0, 0, 0); // road N-S, garden = feature 3
    fx.abbot(0, 0, 0, 3);
    fx.put("U", 0, -1, 0);
    fx.put("U", 0, 1, 0);
    for ([_][2]i16{ .{ -1, 0 }, .{ 1, 0 }, .{ -1, -1 }, .{ 1, -1 }, .{ -1, 1 } }) |c| fx.put("B", c[0], c[1], 0);
    fx.deck(&.{ "B", "B" });
    var e = ev();
    defer e.deinit();
    try fx.game.apply(.{ .x = 1, .y = 1, .rot = 0 }, &e);
    var found = false;
    for (e.items()) |x| switch (x) {
        .feature_scored => |s| if (s.kind == .garden) {
            found = true;
            try expectEqual(@as(u32, 9), s.points);
            try expectEqual(@as(u8, 1), s.winners);
        },
        else => {},
    };
    try expect(found);
    try expectEqual(@as(u32, 9), fx.game.breakdown[0][@intFromEnum(engine.Category.garden)]);
    try expect(fx.game.abbotAvailable(0));
}

test "abbot: scored as a monk at game end" {
    var fx = Fixture.init(no_river, 2);
    fx.put("Ug", 0, 0, 0);
    fx.abbot(0, 0, 0, 3);
    fx.deck(&.{"B"});
    try fx.game.apply(.{ .x = 1, .y = 0, .rot = 0 }, null);
    try expectEqual(@as(u32, 2), fx.game.breakdown[0][@intFromEnum(engine.Category.garden)]);
}

// ---------------------------------------------------------------- the river

test "river setup: spring placed, river tiles first, lake last, start tile shuffled in" {
    const g = try Game.init(std.testing.allocator, .{}, 99, 3);
    try expectEqual(@as(u8, 1), g.placed_len);
    try std.testing.expectEqualStrings("R1", engine.tileId(g.placed[0].tile));
    try expect(tiles.isRiver(g.current_tile));
    try expectEqual(@as(u8, 10 + 1 + 72), g.deck_len);
    try std.testing.expectEqualStrings("R12", engine.tileId(g.deck[10]));
    var d_count: u32 = 0;
    for (g.deck[0..g.deck_len], 0..) |t, i| {
        try expectEqual(i <= 10, tiles.isRiver(t));
        if (t == Fixture.tileIndex("D")) d_count += 1;
    }
    try expectEqual(@as(u32, 4), d_count);
    var buf: [engine.MAX_PLACEMENTS]engine.Placement = undefined;
    for (g.legalPlacements(&buf)) |p| {
        try expectEqual(@as(i16, 0), p.x);
        try expectEqual(@as(i16, 1), p.y);
    }
}

test "no river: start tile D at the origin, 71 tiles in the pile" {
    const g = try Game.init(std.testing.allocator, no_river, 5, 2);
    try std.testing.expectEqualStrings("D", engine.tileId(g.placed[0].tile));
    try expectEqual(@as(u8, 71), g.deck_len);
    try expect(!tiles.isRiver(g.current_tile));
}

fn rotsAt(g: *const Game) [4]bool {
    var out: [4]bool = @splat(false);
    var buf: [engine.MAX_PLACEMENTS]engine.Placement = undefined;
    for (g.legalPlacements(&buf)) |p| out[p.rot] = true;
    return out;
}

test "river: no immediate U-turn (two consecutive bends may not turn the same way)" {
    var fx = Fixture.init(.{}, 2);
    fx.riverStart();
    fx.deck(&.{ "R7", "R10", "R9", "R12" });
    // R7 (bend N-W): both a right (rot 0, -> W) and a left (rot 1, -> E) are legal.
    try expectEqual([4]bool{ true, true, false, false }, rotsAt(&fx.game));
    try fx.game.apply(.{ .x = 0, .y = 1, .rot = 0 }, null); // right turn, now flowing W
    // R10 (bend E-S) at (-1,1): only the left turn (rot 0, -> S) is legal.
    try expectEqual([4]bool{ true, false, false, false }, rotsAt(&fx.game));
    try fx.game.apply(.{ .x = -1, .y = 1, .rot = 0 }, null); // left, flowing S
    // R9 at (-1,2): a second left (rot 3, -> E) would be an immediate U-turn.
    try expectEqual([4]bool{ false, false, true, false }, rotsAt(&fx.game));
    // Meeples cannot stand on the river itself (River: Placing a meeple).
    var obuf: [16]engine.FigureOption = undefined;
    for (fx.game.legalFigures(-1, 2, 2, &obuf)) |o| try expect(o.feature != 1);
    try fx.game.apply(.{ .x = -1, .y = 2, .rot = 2 }, null);
    // Lake closes the river.
    try fx.game.apply(.{ .x = -2, .y = 2, .rot = 1 }, null);
    try expect(!fx.game.river.open);
}

test "river: may never bend back against the spring's direction" {
    var fx = Fixture.init(.{}, 2);
    fx.riverStart();
    fx.deck(&.{ "R7", "R4", "R10", "R12" });
    try fx.game.apply(.{ .x = 0, .y = 1, .rot = 0 }, null); // right, flowing W
    try fx.game.apply(.{ .x = -1, .y = 1, .rot = 1 }, null); // straight W
    // R10 at (-2,1): the right turn would point north, against the spring: only rot 0.
    try expectEqual([4]bool{ true, false, false, false }, rotsAt(&fx.game));
}

test "river: tiles must extend the river; an unplaceable river tile is discarded" {
    var fx = Fixture.init(.{}, 2);
    fx.riverStart();
    // Block every exit from (0,1).
    fx.put("B", -1, 1, 0);
    fx.put("B", 1, 1, 0);
    fx.put("B", 0, 2, 0);
    var e = ev();
    defer e.deinit();
    try fx.deckEvents(&.{ "R4", "R12" }, &e);
    try expect(e.items()[0] == .tile_discarded);
    try std.testing.expectEqualStrings("R12", fx.currentId().?);
    var buf: [engine.MAX_PLACEMENTS]engine.Placement = undefined;
    const ps = fx.game.legalPlacements(&buf);
    try expect(ps.len > 0);
    for (ps) |p| try expect(p.x == 0 and p.y == 1);
}

test "snapshot round trip preserves the hash" {
    var g = try Game.init(std.testing.allocator, .{}, 1234, 4);
    var buf: [engine.MAX_PLACEMENTS]engine.Placement = undefined;
    const p = g.legalPlacements(&buf)[0];
    try g.apply(.{ .x = p.x, .y = p.y, .rot = p.rot }, null);
    var bytes: [Game.SNAPSHOT_SIZE]u8 = undefined;
    g.snapshotBytes(&bytes);
    const r = try Game.restoreBytes(&bytes);
    try expectEqual(g.hash(), r.hash());
    bytes[3] ^= 0xff; // corrupt num_players region or ruleset
    _ = Game.restoreBytes(&bytes) catch {};
}
