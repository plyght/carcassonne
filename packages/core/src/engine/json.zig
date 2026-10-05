//! JSON I/O for the engine, mirroring packages/protocol/src/engine.ts exactly.
const std = @import("std");
const engine = @import("engine.zig");
const tiles = @import("tiles.zig");

const Game = engine.Game;
const Allocator = std.mem.Allocator;

pub const ParseError = error{ BadJson, OutOfMemory };

/// Small append-only JSON writer over an ArrayList(u8).
pub const Writer = struct {
    out: *std.ArrayList(u8),
    gpa: Allocator,

    pub fn raw(self: Writer, s: []const u8) !void {
        try self.out.appendSlice(self.gpa, s);
    }

    pub fn int(self: Writer, v: anytype) !void {
        try self.out.print(self.gpa, "{d}", .{v});
    }

    pub fn boolean(self: Writer, v: bool) !void {
        try self.raw(if (v) "true" else "false");
    }

    pub fn str(self: Writer, s: []const u8) !void {
        try self.raw("\"");
        for (s) |c| switch (c) {
            '"' => try self.raw("\\\""),
            '\\' => try self.raw("\\\\"),
            0...0x1f => try self.out.print(self.gpa, "\\u{x:0>4}", .{c}),
            else => try self.out.append(self.gpa, c),
        };
        try self.raw("\"");
    }

    /// `"name":`
    pub fn key(self: Writer, name: []const u8) !void {
        try self.str(name);
        try self.raw(":");
    }
};

fn kindName(k: engine.FeatureKind) []const u8 {
    return @tagName(k);
}

fn figureName(k: engine.FigureKind) []const u8 {
    return @tagName(k);
}

fn writeWinners(w: Writer, mask: u8) !void {
    try w.raw("[");
    var first = true;
    for (0..engine.MAX_PLAYERS) |p| {
        if (mask & (@as(u8, 1) << @intCast(p)) == 0) continue;
        if (!first) try w.raw(",");
        first = false;
        try w.int(p);
    }
    try w.raw("]");
}

fn writeBreakdown(w: Writer, b: engine.Breakdown) !void {
    try w.raw("{\"road\":");
    try w.int(b[0]);
    try w.raw(",\"city\":");
    try w.int(b[1]);
    try w.raw(",\"cloister\":");
    try w.int(b[2]);
    try w.raw(",\"garden\":");
    try w.int(b[3]);
    try w.raw(",\"field\":");
    try w.int(b[4]);
    try w.raw("}");
}

pub fn writeEvent(w: Writer, e: engine.Event) !void {
    switch (e) {
        .turn_started => |v| {
            try w.raw("{\"type\":\"turnStarted\",\"player\":");
            try w.int(v.player);
            try w.raw(",\"tile\":");
            try w.str(engine.tileId(v.tile));
            try w.raw("}");
        },
        .tile_discarded => |v| {
            try w.raw("{\"type\":\"tileDiscarded\",\"tile\":");
            try w.str(engine.tileId(v.tile));
            try w.raw("}");
        },
        .tile_placed => |v| {
            try w.raw("{\"type\":\"tilePlaced\",\"player\":");
            try w.int(v.player);
            try w.raw(",\"x\":");
            try w.int(v.x);
            try w.raw(",\"y\":");
            try w.int(v.y);
            try w.raw(",\"rot\":");
            try w.int(v.rot);
            try w.raw(",\"tile\":");
            try w.str(engine.tileId(v.tile));
            try w.raw("}");
        },
        .figure_placed => |v| {
            try w.raw("{\"type\":\"figurePlaced\",\"player\":");
            try w.int(v.player);
            try w.raw(",\"x\":");
            try w.int(v.x);
            try w.raw(",\"y\":");
            try w.int(v.y);
            try w.raw(",\"feature\":");
            try w.int(v.feature);
            try w.raw(",\"figure\":");
            try w.str(figureName(v.figure));
            try w.raw("}");
        },
        .feature_scored => |v| {
            try w.raw("{\"type\":\"featureScored\",\"kind\":");
            try w.str(kindName(v.kind));
            try w.raw(",\"cells\":[");
            for (v.cells, 0..) |c, i| {
                if (i > 0) try w.raw(",");
                try w.raw("[");
                try w.int(c.x);
                try w.raw(",");
                try w.int(c.y);
                try w.raw("]");
            }
            try w.raw("],\"winners\":");
            try writeWinners(w, v.winners);
            try w.raw(",\"points\":");
            try w.int(v.points);
            try w.raw(",\"returned\":[");
            for (v.returned, 0..) |r, i| {
                if (i > 0) try w.raw(",");
                try w.raw("{\"player\":");
                try w.int(r.player);
                try w.raw(",\"x\":");
                try w.int(r.x);
                try w.raw(",\"y\":");
                try w.int(r.y);
                try w.raw(",\"feature\":");
                try w.int(r.feature);
                try w.raw(",\"figure\":");
                try w.str(figureName(r.figure));
                try w.raw("}");
            }
            try w.raw("],\"final\":");
            try w.boolean(v.final);
            try w.raw("}");
        },
        .abbot_recalled => |v| {
            try w.raw("{\"type\":\"abbotRecalled\",\"player\":");
            try w.int(v.player);
            try w.raw(",\"x\":");
            try w.int(v.x);
            try w.raw(",\"y\":");
            try w.int(v.y);
            try w.raw(",\"points\":");
            try w.int(v.points);
            try w.raw("}");
        },
        .game_ended => |v| {
            try w.raw("{\"type\":\"gameEnded\",\"scores\":[");
            for (0..v.players) |p| {
                if (p > 0) try w.raw(",");
                try w.int(v.scores[p]);
            }
            try w.raw("],\"breakdown\":[");
            for (0..v.players) |p| {
                if (p > 0) try w.raw(",");
                try writeBreakdown(w, v.breakdown[p]);
            }
            try w.raw("]}");
        },
    }
}

pub fn writeEvents(w: Writer, events: []const engine.Event) !void {
    try w.raw("[");
    for (events, 0..) |e, i| {
        if (i > 0) try w.raw(",");
        try writeEvent(w, e);
    }
    try w.raw("]");
}

/// `{ok:true, events:[...]}`
pub fn writeApplyOk(w: Writer, events: []const engine.Event) !void {
    try w.raw("{\"ok\":true,\"events\":");
    try writeEvents(w, events);
    try w.raw("}");
}

pub fn writeApplyError(w: Writer, message: []const u8) !void {
    try w.raw("{\"ok\":false,\"error\":");
    try w.str(message);
    try w.raw("}");
}

pub fn errorMessage(err: anyerror) []const u8 {
    return switch (err) {
        error.GameOver => "game is over",
        error.IllegalPlacement => "illegal tile placement",
        error.IllegalFigure => "illegal figure action",
        error.BadJson => "malformed move",
        error.OutOfMemory => "out of memory",
        else => "error",
    };
}

pub fn writeRuleset(w: Writer, r: engine.Ruleset) !void {
    try w.raw("{\"fieldEdition\":");
    try w.int(r.field_edition);
    try w.raw(",\"river\":");
    try w.boolean(r.river);
    try w.raw(",\"abbot\":");
    try w.boolean(r.abbot);
    try w.raw(",\"handSize\":");
    try w.int(r.hand_size);
    try w.raw("}");
}

/// The public `GameView`.
pub fn writeView(w: Writer, g: *const Game) !void {
    try w.raw("{\"ply\":");
    try w.int(g.ply);
    try w.raw(",\"status\":");
    try w.str(if (g.status == .playing) "playing" else "ended");
    try w.raw(",\"ruleset\":");
    try writeRuleset(w, g.ruleset);
    try w.raw(",\"players\":[");
    for (0..g.num_players) |p| {
        if (p > 0) try w.raw(",");
        try w.raw("{\"score\":");
        try w.int(g.scores[p]);
        try w.raw(",\"meeples\":");
        try w.int(g.meeplesInSupply(@intCast(p)));
        try w.raw(",\"abbotAvailable\":");
        try w.boolean(g.abbotAvailable(@intCast(p)));
        try w.raw(",\"breakdown\":");
        try writeBreakdown(w, g.breakdown[p]);
        try w.raw("}");
    }
    try w.raw("],\"currentPlayer\":");
    try w.int(g.current_player);
    try w.raw(",\"currentTile\":");
    if (g.currentTile()) |t| try w.str(engine.tileId(t)) else try w.raw("null");
    try w.raw(",\"board\":[");
    for (g.placedTiles(), 0..) |p, slot| {
        if (slot > 0) try w.raw(",");
        try w.raw("{\"x\":");
        try w.int(p.x);
        try w.raw(",\"y\":");
        try w.int(p.y);
        try w.raw(",\"rot\":");
        try w.int(p.rot);
        try w.raw(",\"tile\":");
        try w.str(engine.tileId(p.tile));
        try w.raw(",\"figures\":[");
        var buf: [engine.MAX_PLAYERS * engine.FIGURES_PER_PLAYER]Game.BoardFigure = undefined;
        for (g.figuresOn(@intCast(slot), &buf), 0..) |f, i| {
            if (i > 0) try w.raw(",");
            try w.raw("{\"player\":");
            try w.int(f.player);
            try w.raw(",\"feature\":");
            try w.int(f.feature);
            try w.raw(",\"figure\":");
            try w.str(figureName(f.figure));
            try w.raw("}");
        }
        try w.raw("]}");
    }
    try w.raw("],\"remaining\":{");
    const counts = g.remainingCounts();
    var first = true;
    for (tiles.all, 0..) |t, i| {
        if (t.set == .river and !g.ruleset.river) continue;
        if (t.special == .spring) continue; // never in the pile
        if (!first) try w.raw(",");
        first = false;
        try w.key(t.id);
        try w.int(counts[i]);
    }
    try w.raw("}}");
}

pub fn writePlacements(w: Writer, ps: []const engine.Placement) !void {
    try w.raw("[");
    for (ps, 0..) |p, i| {
        if (i > 0) try w.raw(",");
        try w.raw("{\"x\":");
        try w.int(p.x);
        try w.raw(",\"y\":");
        try w.int(p.y);
        try w.raw(",\"rot\":");
        try w.int(p.rot);
        try w.raw("}");
    }
    try w.raw("]");
}

pub fn writeFigureOptions(w: Writer, opts: []const engine.FigureOption) !void {
    try w.raw("[");
    for (opts, 0..) |o, i| {
        if (i > 0) try w.raw(",");
        try w.raw("{\"type\":");
        try w.str(figureName(o.kind));
        try w.raw(",\"feature\":");
        try w.int(o.feature);
        try w.raw("}");
    }
    try w.raw("]");
}

pub fn writeMove(w: Writer, m: engine.Move) !void {
    try w.raw("{\"x\":");
    try w.int(m.x);
    try w.raw(",\"y\":");
    try w.int(m.y);
    try w.raw(",\"rot\":");
    try w.int(m.rot);
    try w.raw(",\"figure\":");
    switch (m.figure) {
        .none => try w.raw("null"),
        .meeple => |f| {
            try w.raw("{\"type\":\"meeple\",\"feature\":");
            try w.int(f);
            try w.raw("}");
        },
        .abbot => |f| {
            try w.raw("{\"type\":\"abbot\",\"feature\":");
            try w.int(f);
            try w.raw("}");
        },
        .recall_abbot => |c| {
            try w.raw("{\"type\":\"recallAbbot\",\"x\":");
            try w.int(c.x);
            try w.raw(",\"y\":");
            try w.int(c.y);
            try w.raw("}");
        },
    }
    try w.raw("}");
}

/// Snapshot: `{"v":1,"hash":"<hex>","state":"<base64>"}`.
pub fn writeSnapshot(w: Writer, g: *const Game) !void {
    var bytes: [Game.SNAPSHOT_SIZE]u8 = undefined;
    g.snapshotBytes(&bytes);
    const enc = std.base64.standard.Encoder;
    const b64 = try w.gpa.alloc(u8, enc.calcSize(bytes.len));
    defer w.gpa.free(b64);
    _ = enc.encode(b64, &bytes);
    try w.raw("{\"v\":1,\"hash\":\"");
    try w.out.print(w.gpa, "{x:0>16}", .{g.hash()});
    try w.raw("\",\"state\":");
    try w.str(b64);
    try w.raw("}");
}

// ---------------------------------------------------------------- parsing

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

fn coord(v: i64) ParseError!i16 {
    if (v < -1000 or v > 1000) return error.BadJson;
    return @intCast(v);
}

pub fn parseRuleset(gpa: Allocator, bytes: []const u8) ParseError!engine.Ruleset {
    const parsed = std.json.parseFromSlice(std.json.Value, gpa, bytes, .{}) catch |e| return switch (e) {
        error.OutOfMemory => error.OutOfMemory,
        else => error.BadJson,
    };
    defer parsed.deinit();
    const obj = switch (parsed.value) {
        .object => |o| o,
        else => return error.BadJson,
    };
    var r: engine.Ruleset = .{};
    if (getInt(obj, "fieldEdition")) |e| {
        if (e < 1 or e > 3) return error.BadJson;
        r.field_edition = @intCast(e);
    }
    if (getBool(obj, "river")) |b| r.river = b;
    if (getBool(obj, "abbot")) |b| r.abbot = b;
    if (getInt(obj, "handSize")) |h| {
        if (h < 1 or h > 3) return error.BadJson;
        r.hand_size = @intCast(h);
    }
    return r;
}

pub fn parseMove(gpa: Allocator, bytes: []const u8) ParseError!engine.Move {
    const parsed = std.json.parseFromSlice(std.json.Value, gpa, bytes, .{}) catch |e| return switch (e) {
        error.OutOfMemory => error.OutOfMemory,
        else => error.BadJson,
    };
    defer parsed.deinit();
    const obj = switch (parsed.value) {
        .object => |o| o,
        else => return error.BadJson,
    };
    const x = try coord(getInt(obj, "x") orelse return error.BadJson);
    const y = try coord(getInt(obj, "y") orelse return error.BadJson);
    const rot = getInt(obj, "rot") orelse return error.BadJson;
    if (rot < 0 or rot > 3) return error.BadJson;
    var m: engine.Move = .{ .x = x, .y = y, .rot = @intCast(rot) };
    const fig = obj.get("figure") orelse return m;
    switch (fig) {
        .null => {},
        .object => |f| {
            const ty = switch (f.get("type") orelse return error.BadJson) {
                .string => |s| s,
                else => return error.BadJson,
            };
            if (std.mem.eql(u8, ty, "recallAbbot")) {
                m.figure = .{ .recall_abbot = .{
                    .x = try coord(getInt(f, "x") orelse return error.BadJson),
                    .y = try coord(getInt(f, "y") orelse return error.BadJson),
                } };
            } else {
                const feat = getInt(f, "feature") orelse return error.BadJson;
                if (feat < 0 or feat >= engine.MAX_FEATURES) return error.BadJson;
                if (std.mem.eql(u8, ty, "meeple")) {
                    m.figure = .{ .meeple = @intCast(feat) };
                } else if (std.mem.eql(u8, ty, "abbot")) {
                    m.figure = .{ .abbot = @intCast(feat) };
                } else return error.BadJson;
            }
        },
        else => return error.BadJson,
    }
    return m;
}

pub fn parseSnapshot(gpa: Allocator, bytes: []const u8) (ParseError || error{BadSnapshot})!Game {
    const parsed = std.json.parseFromSlice(std.json.Value, gpa, bytes, .{}) catch |e| return switch (e) {
        error.OutOfMemory => error.OutOfMemory,
        else => error.BadJson,
    };
    defer parsed.deinit();
    const obj = switch (parsed.value) {
        .object => |o| o,
        else => return error.BadJson,
    };
    if ((getInt(obj, "v") orelse 0) != 1) return error.BadSnapshot;
    const state = switch (obj.get("state") orelse return error.BadJson) {
        .string => |s| s,
        else => return error.BadJson,
    };
    const dec = std.base64.standard.Decoder;
    const n = dec.calcSizeForSlice(state) catch return error.BadSnapshot;
    if (n != Game.SNAPSHOT_SIZE) return error.BadSnapshot;
    var buf: [Game.SNAPSHOT_SIZE]u8 = undefined;
    dec.decode(&buf, state) catch return error.BadSnapshot;
    const g = try Game.restoreBytes(&buf);
    if (obj.get("hash")) |h| {
        const hs = switch (h) {
            .string => |s| s,
            else => return error.BadJson,
        };
        const want = std.fmt.parseInt(u64, hs, 16) catch return error.BadSnapshot;
        if (want != g.hash()) return error.BadSnapshot;
    }
    return g;
}
