//! Engine support for clients that only hold the public `GameView` (online
//! players and spectators never receive the deck seed).
//!
//! - `fromView` rebuilds a `Game` from a view: the board is replayed in placement
//!   order (the view lists tiles by slot), so features, open edges and the river
//!   state come out exactly as on the server. Figures, scores and the turn come
//!   from the view. The draw pile is the view's remaining tiles in catalog order:
//!   good for legality queries and search, never for drawing "real" tiles.
//! - `writeCatalog` emits the tile table as JSON for renderers and UI analysis.
//!
//! Additive: nothing in the engine depends on this file.
const std = @import("std");
const engine = @import("engine.zig");
const tiles = @import("tiles.zig");
const json = @import("json.zig");

const Game = engine.Game;
const Allocator = std.mem.Allocator;

pub const FromViewError = error{ BadJson, BadView, OutOfMemory };

const dx = [4]i16{ 0, 1, 0, -1 };
const dy = [4]i16{ -1, 0, 1, 0 };

fn getInt(obj: std.json.ObjectMap, name: []const u8) ?i64 {
    const v = obj.get(name) orelse return null;
    return switch (v) {
        .integer => |i| i,
        .float => |f| if (@floor(f) == f and @abs(f) < 1e9) @intFromFloat(f) else null,
        else => null,
    };
}

fn getBool(obj: std.json.ObjectMap, name: []const u8) ?bool {
    const v = obj.get(name) orelse return null;
    return switch (v) {
        .bool => |b| b,
        else => null,
    };
}

fn getStr(obj: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const v = obj.get(name) orelse return null;
    return switch (v) {
        .string => |s| s,
        else => null,
    };
}

fn getObj(v: std.json.Value) ?std.json.ObjectMap {
    return switch (v) {
        .object => |o| o,
        else => null,
    };
}

fn getArr(obj: std.json.ObjectMap, name: []const u8) ?[]std.json.Value {
    const v = obj.get(name) orelse return null;
    return switch (v) {
        .array => |a| a.items,
        else => null,
    };
}

fn intIn(v: ?i64, lo: i64, hi: i64) FromViewError!i64 {
    const x = v orelse return error.BadView;
    if (x < lo or x > hi) return error.BadView;
    return x;
}

fn parseRuleset(obj: std.json.ObjectMap) FromViewError!engine.Ruleset {
    var r: engine.Ruleset = .{};
    r.field_edition = @intCast(try intIn(getInt(obj, "fieldEdition"), 1, 3));
    r.river = getBool(obj, "river") orelse return error.BadView;
    r.abbot = getBool(obj, "abbot") orelse return error.BadView;
    if (getInt(obj, "handSize")) |h| {
        if (h != 1) return error.BadView;
    }
    return r;
}

/// River sides of a rotated tile (bit s = side s).
fn riverSides(t: tiles.TileIndex, rot: u2) u4 {
    const r = &tiles.rotated[t][rot];
    var m: u4 = 0;
    for (0..4) |s| {
        if (r.edges[s] == .river) m |= @as(u4, 1) << @intCast(s);
    }
    return m;
}

/// Rebuild a game from a public `GameView` JSON document (see packages/protocol).
pub fn fromView(gpa: Allocator, bytes: []const u8) FromViewError!Game {
    const parsed = std.json.parseFromSlice(std.json.Value, gpa, bytes, .{}) catch |e| return switch (e) {
        error.OutOfMemory => error.OutOfMemory,
        else => error.BadJson,
    };
    defer parsed.deinit();
    const root = getObj(parsed.value) orelse return error.BadJson;

    const ruleset = try parseRuleset(getObj(root.get("ruleset") orelse return error.BadView) orelse return error.BadView);
    const players = getArr(root, "players") orelse return error.BadView;
    if (players.len < engine.MIN_PLAYERS or players.len > engine.MAX_PLAYERS) return error.BadView;

    var g: Game = .{ .ruleset = ruleset, .seed = 0, .num_players = @intCast(players.len) };
    g.ply = @intCast(try intIn(getInt(root, "ply"), 0, 1 << 20));
    const status = getStr(root, "status") orelse return error.BadView;
    g.status = if (std.mem.eql(u8, status, "ended")) .ended else if (std.mem.eql(u8, status, "playing")) .playing else return error.BadView;
    g.current_player = @intCast(try intIn(getInt(root, "currentPlayer"), 0, @as(i64, @intCast(players.len)) - 1));

    // Board, in placement order.
    const board = getArr(root, "board") orelse return error.BadView;
    if (board.len == 0 or board.len > engine.MAX_SLOTS) return error.BadView;
    for (board, 0..) |bv, slot| {
        const b = getObj(bv) orelse return error.BadView;
        const x: i16 = @intCast(try intIn(getInt(b, "x"), -1000, 1000));
        const y: i16 = @intCast(try intIn(getInt(b, "y"), -1000, 1000));
        const rot: u2 = @intCast(try intIn(getInt(b, "rot"), 0, 3));
        const t = tiles.indexOf(getStr(b, "tile") orelse return error.BadView) orelse return error.BadView;
        if (slot == 0) {
            g.putTile(t, x, y, rot);
            if (tiles.def(t).special == .spring) {
                const sides = riverSides(t, rot);
                if (sides == 0) return error.BadView;
                const s: u2 = @intCast(@ctz(sides));
                g.river = .{ .open = true, .x = x + dx[s], .y = y + dy[s], .heading = s, .spring_dir = s, .last_turn = 0 };
            }
        } else {
            if (!g.canPlace(t, x, y, rot)) return error.BadView;
            g.putTile(t, x, y, rot);
        }
    }

    // Figures.
    var used: [engine.MAX_PLAYERS]u8 = @splat(0);
    for (board, 0..) |bv, slot| {
        const b = getObj(bv).?;
        const figs = getArr(b, "figures") orelse continue;
        const nf = tiles.def(g.placed[slot].tile).features.len;
        for (figs) |fv| {
            const f = getObj(fv) orelse return error.BadView;
            const p: usize = @intCast(try intIn(getInt(f, "player"), 0, @as(i64, @intCast(players.len)) - 1));
            const feature: u8 = @intCast(try intIn(getInt(f, "feature"), 0, @as(i64, @intCast(nf)) - 1));
            const kind = getStr(f, "figure") orelse return error.BadView;
            if (std.mem.eql(u8, kind, "abbot")) {
                if (g.figures[p][engine.ABBOT_SLOT].on_board) return error.BadView;
                g.figures[p][engine.ABBOT_SLOT] = .{ .on_board = true, .slot = @intCast(slot), .feature = feature };
            } else if (std.mem.eql(u8, kind, "meeple")) {
                if (used[p] >= engine.MEEPLES_PER_PLAYER) return error.BadView;
                g.figures[p][used[p]] = .{ .on_board = true, .slot = @intCast(slot), .feature = feature };
                used[p] += 1;
            } else return error.BadView;
        }
    }

    // Scores.
    for (players, 0..) |pv, p| {
        const po = getObj(pv) orelse return error.BadView;
        g.scores[p] = @intCast(try intIn(getInt(po, "score"), 0, 1 << 24));
        if (po.get("breakdown")) |bdv| {
            const bd = getObj(bdv) orelse return error.BadView;
            const names = [_][]const u8{ "road", "city", "cloister", "garden", "field" };
            for (names, 0..) |n, i| g.breakdown[p][i] = @intCast(try intIn(getInt(bd, n) orelse 0, 0, 1 << 24));
        }
    }

    // Draw pile: the remaining tiles, in catalog order.
    if (root.get("remaining")) |rv| {
        const rem = getObj(rv) orelse return error.BadView;
        var it = rem.iterator();
        var n: usize = 0;
        while (it.next()) |e| {
            const t = tiles.indexOf(e.key_ptr.*) orelse return error.BadView;
            const c = switch (e.value_ptr.*) {
                .integer => |i| i,
                else => return error.BadView,
            };
            if (c < 0 or n + @as(usize, @intCast(c)) > engine.MAX_SLOTS) return error.BadView;
            for (0..@intCast(c)) |_| {
                g.deck[n] = t;
                n += 1;
            }
        }
        std.mem.sort(tiles.TileIndex, g.deck[0..n], {}, std.sort.asc(tiles.TileIndex));
        g.deck_len = @intCast(n);
        g.deck_pos = 0;
    }

    if (g.status == .playing) {
        const cur = getStr(root, "currentTile") orelse return error.BadView;
        g.current_tile = tiles.indexOf(cur) orelse return error.BadView;
    }
    return g;
}

/// The tile catalog as JSON:
/// `[{id, count, set, special, features:[{kind, ports, pennants, adjacentCities}]}]`.
pub fn writeCatalog(w: json.Writer) !void {
    try w.raw("[");
    for (tiles.all, 0..) |t, i| {
        if (i > 0) try w.raw(",");
        try w.raw("{\"id\":");
        try w.str(t.id);
        try w.raw(",\"count\":");
        try w.int(t.count);
        try w.raw(",\"set\":");
        try w.str(@tagName(t.set));
        try w.raw(",\"special\":");
        try w.str(@tagName(t.special));
        try w.raw(",\"features\":[");
        for (t.features, 0..) |f, fi| {
            if (fi > 0) try w.raw(",");
            try w.raw("{\"kind\":");
            try w.str(@tagName(f.kind));
            try w.raw(",\"ports\":");
            try w.int(f.ports);
            try w.raw(",\"pennants\":");
            try w.int(f.pennants);
            try w.raw(",\"adjacentCities\":[");
            for (f.adjacent_cities, 0..) |c, ci| {
                if (ci > 0) try w.raw(",");
                try w.int(c);
            }
            try w.raw("]}");
        }
        try w.raw("]}");
    }
    try w.raw("]");
}

// ---------------------------------------------------------------- tests

const testing = std.testing;

fn viewJson(g: *const Game) ![]u8 {
    var out: std.ArrayList(u8) = .empty;
    errdefer out.deinit(testing.allocator);
    try json.writeView(.{ .out = &out, .gpa = testing.allocator }, g);
    return out.toOwnedSlice(testing.allocator);
}

fn samePlacements(a: *const Game, b: *const Game) !void {
    var ba: [engine.MAX_PLACEMENTS]engine.Placement = undefined;
    var bb: [engine.MAX_PLACEMENTS]engine.Placement = undefined;
    const pa = a.legalPlacements(&ba);
    const pb = b.legalPlacements(&bb);
    try testing.expectEqual(pa.len, pb.len);
    for (pa, pb) |x, y| try testing.expectEqual(x, y);
    // Figures for every placement agree too.
    for (pa) |p| {
        var fa: [2 * engine.MAX_FEATURES]engine.FigureOption = undefined;
        var fb: [2 * engine.MAX_FEATURES]engine.FigureOption = undefined;
        const oa = a.legalFigures(p.x, p.y, p.rot, &fa);
        const ob = b.legalFigures(p.x, p.y, p.rot, &fb);
        try testing.expectEqual(oa.len, ob.len);
        for (oa, ob) |x, y| try testing.expectEqual(x, y);
    }
}

fn playAndCompare(ruleset: engine.Ruleset, seed: u64, players: u8, plies: usize) !void {
    var g = try Game.init(testing.allocator, ruleset, seed, players);
    var rng = std.Random.DefaultPrng.init(seed ^ 0x9e37);
    var i: usize = 0;
    while (i < plies and g.status == .playing) : (i += 1) {
        const text = try viewJson(&g);
        defer testing.allocator.free(text);
        var v = try fromView(testing.allocator, text);
        try samePlacements(&g, &v);
        // The rebuilt game renders the same public view.
        const again = try viewJson(&v);
        defer testing.allocator.free(again);
        try testing.expectEqualStrings(text, again);

        var buf: [engine.MAX_PLACEMENTS]engine.Placement = undefined;
        const ps = g.legalPlacements(&buf);
        const p = ps[rng.random().uintLessThan(usize, ps.len)];
        var fb: [2 * engine.MAX_FEATURES]engine.FigureOption = undefined;
        const opts = g.legalFigures(p.x, p.y, p.rot, &fb);
        var m: engine.Move = .{ .x = p.x, .y = p.y, .rot = p.rot };
        if (opts.len > 0 and rng.random().boolean()) {
            const o = opts[rng.random().uintLessThan(usize, opts.len)];
            m.figure = if (o.kind == .meeple) .{ .meeple = o.feature } else .{ .abbot = o.feature };
        }
        try g.apply(m, null);
    }
}

test "fromView: rebuilt games agree with the real game (river + abbot)" {
    try playAndCompare(.{}, 0x5eed, 3, 90);
    try playAndCompare(.{}, 42, 2, 90);
}

test "fromView: rebuilt games agree with the real game (base only)" {
    try playAndCompare(.{ .river = false, .abbot = false }, 7, 4, 80);
}

test "fromView: rejects malformed views" {
    try testing.expectError(error.BadJson, fromView(testing.allocator, "{"));
    try testing.expectError(error.BadView, fromView(testing.allocator, "{\"ruleset\":{\"fieldEdition\":3,\"river\":false,\"abbot\":true},\"players\":[]}"));
    // Two tiles that do not fit.
    const bad =
        \\{"ply":1,"status":"playing","ruleset":{"fieldEdition":3,"river":false,"abbot":true,"handSize":1},
        \\"players":[{"score":0,"meeples":7,"abbotAvailable":true},{"score":0,"meeples":7,"abbotAvailable":true}],
        \\"currentPlayer":0,"currentTile":"U","board":[{"x":0,"y":0,"rot":0,"tile":"D","figures":[]},
        \\{"x":0,"y":-1,"rot":0,"tile":"U","figures":[]}],"remaining":{}}
    ;
    try testing.expectError(error.BadView, fromView(testing.allocator, bad));
}

test "catalog JSON lists every tile" {
    var out: std.ArrayList(u8) = .empty;
    defer out.deinit(testing.allocator);
    try writeCatalog(.{ .out = &out, .gpa = testing.allocator });
    const parsed = try std.json.parseFromSlice(std.json.Value, testing.allocator, out.items, .{});
    defer parsed.deinit();
    try testing.expectEqual(tiles.count, parsed.value.array.items.len);
}
