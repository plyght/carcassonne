//! Presentation timeline: turns engine events (packages/protocol/src/engine.ts)
//! into keyed animation clips that every renderer plays identically.
//! Pure data and deterministic; the JSON shape is documented in README.md and
//! typed in packages/core-geo/src/anim.ts.

const std = @import("std");
const registry = @import("../geo/registry.zig");
const Allocator = std.mem.Allocator;
const Value = std.json.Value;

pub const Style = enum { realistic, cartoon, reduced };

pub const Easing = enum { linear, step, easeOutCubic, easeInOutCubic, easeInCubic, easeOutBack, easeOutBounce, easeOutElastic };

pub const ClipKind = enum { cameraFocus, tileDrop, lifeRise, wallExtrude, tileDiscard, meepleHopIn, meepleHopOut, featurePulse, scorePopup, gameEnd };

pub const Options = struct {
    style: Style = .realistic,
    speed: f64 = 1,
};

/// Per-style timing + easing for one clip kind.
const Spec = struct { dur: f64, ease: Easing };

fn spec(style: Style, k: ClipKind) Spec {
    return switch (style) {
        .realistic => switch (k) {
            .cameraFocus => .{ .dur = 0.6, .ease = .easeInOutCubic },
            .tileDrop => .{ .dur = 0.35, .ease = .easeOutCubic },
            .lifeRise => .{ .dur = 0.5, .ease = .easeOutCubic },
            .wallExtrude => .{ .dur = 0.45, .ease = .easeOutCubic },
            .tileDiscard => .{ .dur = 0.4, .ease = .easeInCubic },
            .meepleHopIn => .{ .dur = 0.4, .ease = .easeOutCubic },
            .meepleHopOut => .{ .dur = 0.45, .ease = .easeInCubic },
            .featurePulse => .{ .dur = 0.8, .ease = .easeInOutCubic },
            .scorePopup => .{ .dur = 1.2, .ease = .easeOutCubic },
            .gameEnd => .{ .dur = 2.0, .ease = .easeInOutCubic },
        },
        .cartoon => switch (k) {
            .cameraFocus => .{ .dur = 0.55, .ease = .easeOutBack },
            .tileDrop => .{ .dur = 0.5, .ease = .easeOutBounce },
            .lifeRise => .{ .dur = 0.55, .ease = .easeOutBack },
            .wallExtrude => .{ .dur = 0.5, .ease = .easeOutBack },
            .tileDiscard => .{ .dur = 0.45, .ease = .easeOutBack },
            .meepleHopIn => .{ .dur = 0.5, .ease = .easeOutElastic },
            .meepleHopOut => .{ .dur = 0.45, .ease = .easeOutBack },
            .featurePulse => .{ .dur = 0.7, .ease = .easeOutElastic },
            .scorePopup => .{ .dur = 1.0, .ease = .easeOutBack },
            .gameEnd => .{ .dur = 2.2, .ease = .easeOutBounce },
        },
        // Reduced motion: everything instant; popups / end screen still need
        // to be readable, so they hold (step easing = appear at start).
        .reduced => switch (k) {
            .scorePopup => .{ .dur = 1.0, .ease = .step },
            .gameEnd => .{ .dur = 2.0, .ease = .step },
            else => .{ .dur = 0, .ease = .step },
        },
    };
}

const Writer = struct {
    a: Allocator,
    out: std.ArrayList(u8) = .empty,
    clips: usize = 0,
    end: f64 = 0,
    opts: Options,

    fn raw(self: *Writer, s: []const u8) !void {
        try self.out.appendSlice(self.a, s);
    }
    fn print(self: *Writer, comptime f: []const u8, args: anytype) !void {
        try self.out.print(self.a, f, args);
    }
    fn num(self: *Writer, v: f64) !void {
        // fixed 3 decimals: identical text on every target
        const ms: i64 = @intFromFloat(@round(v * 1000));
        const neg = ms < 0;
        const am: u64 = @abs(ms);
        try self.print("{s}{d}.{d:0>3}", .{ if (neg) "-" else "", am / 1000, am % 1000 });
    }

    /// Opens a clip object; the caller writes `target` (and params) then calls close.
    fn open(self: *Writer, ev: usize, kind: ClipKind, sub: ?usize, start: f64, dur_override: ?f64) !void {
        const sp = spec(self.opts.style, kind);
        const dur = (dur_override orelse sp.dur) / self.opts.speed;
        const st = start / self.opts.speed;
        if (self.clips > 0) try self.raw(",");
        self.clips += 1;
        try self.print("{{\"key\":\"e{d}:{s}", .{ ev, @tagName(kind) });
        if (sub) |n| try self.print(":{d}", .{n});
        try self.print("\",\"kind\":\"{s}\",\"event\":{d},\"start\":", .{ @tagName(kind), ev });
        try self.num(st);
        try self.raw(",\"duration\":");
        try self.num(dur);
        try self.print(",\"easing\":\"{s}\"", .{@tagName(sp.ease)});
        self.end = @max(self.end, st + dur);
    }
    fn close(self: *Writer) !void {
        try self.raw("}");
    }
};

fn getInt(v: Value, key: []const u8) i64 {
    if (v != .object) return 0;
    const x = v.object.get(key) orelse return 0;
    return switch (x) {
        .integer => |i| i,
        .float => |f| @intFromFloat(f),
        else => 0,
    };
}

fn getStr(v: Value, key: []const u8) []const u8 {
    if (v != .object) return "";
    const x = v.object.get(key) orelse return "";
    return if (x == .string) x.string else "";
}

fn getBool(v: Value, key: []const u8) bool {
    if (v != .object) return false;
    const x = v.object.get(key) orelse return false;
    return x == .bool and x.bool;
}

fn writeJsonString(w: *Writer, s: []const u8) !void {
    try w.raw("\"");
    for (s) |c| switch (c) {
        '"' => try w.raw("\\\""),
        '\\' => try w.raw("\\\\"),
        0...0x1f => try w.print("\\u{x:0>4}", .{c}),
        else => try w.out.append(w.a, c),
    };
    try w.raw("\"");
}

fn tileHasCity(id: []const u8) bool {
    const t = registry.byId(id) orelse return true; // unknown: let the renderer decide
    for (t.features) |f| if (f.kind == .city) return true;
    return false;
}

fn parseOptions(a: Allocator, json: []const u8) Options {
    var o = Options{};
    if (json.len == 0) return o;
    const parsed = std.json.parseFromSliceLeaky(Value, a, json, .{}) catch return o;
    const s = getStr(parsed, "style");
    if (std.mem.eql(u8, s, "cartoon")) o.style = .cartoon else if (std.mem.eql(u8, s, "reduced")) o.style = .reduced;
    if (parsed == .object) if (parsed.object.get("speed")) |sp| {
        const v: f64 = switch (sp) {
            .integer => |i| @floatFromInt(i),
            .float => |f| f,
            else => 1,
        };
        if (v > 0.05 and v < 20) o.speed = v;
    };
    return o;
}

/// Builds the timeline JSON for `events_json` (an array of EngineEvent, or an
/// ApplyResult `{ok, events}`), with options JSON `{style, speed}`.
pub fn timelineJson(a: Allocator, events_json: []const u8, opts_json: []const u8) ![]u8 {
    const opts = parseOptions(a, opts_json);
    const root = try std.json.parseFromSliceLeaky(Value, a, events_json, .{});
    const events: []const Value = switch (root) {
        .array => |arr| arr.items,
        .object => |o| if (o.get("events")) |e| (if (e == .array) e.array.items else &.{}) else &.{},
        else => &.{},
    };

    var w = Writer{ .a = a, .opts = opts };
    const reduced = opts.style == .reduced;
    const cartoon = opts.style == .cartoon;
    // in reduced motion nothing waits for motion, so the cursor stays put
    const adv: f64 = if (reduced) 0 else 1;
    var t: f64 = 0;

    try w.print("{{\"version\":1,\"style\":\"{s}\",\"clips\":[", .{@tagName(opts.style)});
    for (events, 0..) |ev, ei| {
        const ty = getStr(ev, "type");
        if (std.mem.eql(u8, ty, "tilePlaced")) {
            const x = getInt(ev, "x");
            const y = getInt(ev, "y");
            const rot = getInt(ev, "rot");
            const id = getStr(ev, "tile");
            const drop = spec(opts.style, .tileDrop).dur;
            const tileTarget = struct {
                fn f(wr: *Writer, xx: i64, yy: i64, r: i64, tid: []const u8) !void {
                    try wr.print(",\"target\":{{\"type\":\"tile\",\"x\":{d},\"y\":{d},\"rot\":{d},\"tile\":", .{ xx, yy, r });
                    try writeJsonString(wr, tid);
                    try wr.raw("}");
                }
            }.f;
            try w.open(ei, .cameraFocus, null, t, null);
            try w.print(",\"target\":{{\"type\":\"point\",\"x\":{d}.5,\"y\":{d}.5}},\"params\":{{\"cx\":{d}.5,\"cy\":{d}.5,\"extent\":1.5,\"priority\":0.3}}", .{ x, y, x, y });
            try w.close();
            try w.open(ei, .tileDrop, null, t, null);
            try tileTarget(&w, x, y, rot, id);
            if (cartoon) try w.raw(",\"params\":{\"fromHeight\":0.8,\"squash\":0.18}") else try w.raw(",\"params\":{\"fromHeight\":0.6}");
            try w.close();
            try w.open(ei, .lifeRise, null, t + drop * adv, null);
            try tileTarget(&w, x, y, rot, id);
            if (cartoon) try w.raw(",\"params\":{\"overshoot\":1.7}");
            try w.close();
            if (tileHasCity(id)) {
                try w.open(ei, .wallExtrude, null, t + (drop + 0.1) * adv, null);
                try tileTarget(&w, x, y, rot, id);
                if (cartoon) try w.raw(",\"params\":{\"overshoot\":1.7}");
                try w.close();
            }
            t += (drop + 0.15) * adv;
        } else if (std.mem.eql(u8, ty, "figurePlaced")) {
            try w.open(ei, .meepleHopIn, null, t, null);
            try w.print(",\"target\":{{\"type\":\"figure\",\"x\":{d},\"y\":{d},\"feature\":{d},\"player\":{d},\"figure\":", .{ getInt(ev, "x"), getInt(ev, "y"), getInt(ev, "feature"), getInt(ev, "player") });
            try writeJsonString(&w, getStr(ev, "figure"));
            try w.print("}},\"params\":{{\"hopHeight\":{s}}}", .{if (cartoon) "0.4" else "0.25"});
            try w.close();
            t += spec(opts.style, .meepleHopIn).dur * 0.8 * adv;
        } else if (std.mem.eql(u8, ty, "featureScored")) {
            const final = getBool(ev, "final");
            const points = getInt(ev, "points");
            // centroid + extent of the scored cells (cell (x,y) spans [x,x+1])
            var cx: f64 = 0;
            var cy: f64 = 0;
            var n: f64 = 0;
            var minx: f64 = std.math.inf(f64);
            var maxx: f64 = -std.math.inf(f64);
            var miny: f64 = std.math.inf(f64);
            var maxy: f64 = -std.math.inf(f64);
            const cells: []const Value = if (ev.object.get("cells")) |c| (if (c == .array) c.array.items else &.{}) else &.{};
            for (cells) |c| {
                if (c != .array or c.array.items.len < 2) continue;
                const fx: f64 = @floatFromInt(switch (c.array.items[0]) {
                    .integer => |i| i,
                    else => 0,
                });
                const fy: f64 = @floatFromInt(switch (c.array.items[1]) {
                    .integer => |i| i,
                    else => 0,
                });
                cx += fx + 0.5;
                cy += fy + 0.5;
                n += 1;
                minx = @min(minx, fx);
                maxx = @max(maxx, fx + 1);
                miny = @min(miny, fy);
                maxy = @max(maxy, fy + 1);
            }
            if (n > 0) {
                cx /= n;
                cy /= n;
            } else {
                minx = 0;
                maxx = 1;
                miny = 0;
                maxy = 1;
            }
            const extent = @max(maxx - minx, maxy - miny) * 0.5 + 0.5;
            const pace: f64 = if (final) 0.6 else 1;

            if (!final) {
                try w.open(ei, .cameraFocus, null, t, null);
                try w.raw(",\"target\":{\"type\":\"point\",\"x\":");
                try w.num(cx);
                try w.raw(",\"y\":");
                try w.num(cy);
                try w.raw("},\"params\":{\"cx\":");
                try w.num(cx);
                try w.raw(",\"cy\":");
                try w.num(cy);
                try w.raw(",\"extent\":");
                try w.num(extent);
                try w.raw(",\"priority\":");
                try w.num(@min(1.0, 0.4 + @as(f64, @floatFromInt(points)) / 20.0));
                try w.raw("}");
                try w.close();
            }
            try w.open(ei, .featurePulse, null, t, null);
            try w.print(",\"target\":{{\"type\":\"feature\",\"kind\":", .{});
            try writeJsonString(&w, getStr(ev, "kind"));
            try w.raw(",\"cells\":[");
            for (cells, 0..) |c, ci| {
                if (ci > 0) try w.raw(",");
                if (c == .array and c.array.items.len >= 2) {
                    try w.print("[{d},{d}]", .{ switch (c.array.items[0]) {
                        .integer => |i| i,
                        else => 0,
                    }, switch (c.array.items[1]) {
                        .integer => |i| i,
                        else => 0,
                    } });
                } else try w.raw("[0,0]");
            }
            try w.raw("]}");
            try w.close();

            try w.open(ei, .scorePopup, null, t + 0.2 * pace * adv, null);
            try w.raw(",\"target\":{\"type\":\"point\",\"x\":");
            try w.num(cx);
            try w.raw(",\"y\":");
            try w.num(cy);
            try w.print("}},\"params\":{{\"points\":{d},\"final\":{s},\"winners\":[", .{ points, if (final) "true" else "false" });
            const winners: []const Value = if (ev.object.get("winners")) |x| (if (x == .array) x.array.items else &.{}) else &.{};
            for (winners, 0..) |wv, wi| {
                if (wi > 0) try w.raw(",");
                try w.print("{d}", .{if (wv == .integer) wv.integer else 0});
            }
            try w.raw("]");
            if (cartoon) try w.raw(",\"overshoot\":1.7");
            try w.raw("}");
            try w.close();

            const returned: []const Value = if (ev.object.get("returned")) |x| (if (x == .array) x.array.items else &.{}) else &.{};
            for (returned, 0..) |r, ri| {
                const st = t + (0.5 * pace + 0.08 * @as(f64, @floatFromInt(ri))) * adv;
                try w.open(ei, .meepleHopOut, ri, st, null);
                try w.print(",\"target\":{{\"type\":\"figure\",\"x\":{d},\"y\":{d},\"feature\":{d},\"player\":{d},\"figure\":", .{ getInt(r, "x"), getInt(r, "y"), getInt(r, "feature"), getInt(r, "player") });
                try writeJsonString(&w, getStr(r, "figure"));
                try w.print("}},\"params\":{{\"hopHeight\":{s}}}", .{if (cartoon) "0.45" else "0.3"});
                try w.close();
            }
            t += (0.9 * pace + 0.08 * @as(f64, @floatFromInt(returned.len))) * adv;
        } else if (std.mem.eql(u8, ty, "abbotRecalled")) {
            const x = getInt(ev, "x");
            const y = getInt(ev, "y");
            try w.open(ei, .meepleHopOut, null, t, null);
            try w.print(",\"target\":{{\"type\":\"figure\",\"x\":{d},\"y\":{d},\"feature\":-1,\"player\":{d},\"figure\":\"abbot\"}},\"params\":{{\"hopHeight\":{s}}}", .{ x, y, getInt(ev, "player"), if (cartoon) "0.45" else "0.3" });
            try w.close();
            try w.open(ei, .scorePopup, null, t + 0.1 * adv, null);
            try w.print(",\"target\":{{\"type\":\"point\",\"x\":{d}.5,\"y\":{d}.5}},\"params\":{{\"points\":{d},\"final\":false,\"winners\":[{d}]}}", .{ x, y, getInt(ev, "points"), getInt(ev, "player") });
            try w.close();
            t += 0.6 * adv;
        } else if (std.mem.eql(u8, ty, "tileDiscarded")) {
            try w.open(ei, .tileDiscard, null, t, null);
            try w.raw(",\"target\":{\"type\":\"hand\",\"tile\":");
            try writeJsonString(&w, getStr(ev, "tile"));
            try w.raw("}");
            try w.close();
            t += 0.4 * adv;
        } else if (std.mem.eql(u8, ty, "gameEnded")) {
            try w.open(ei, .cameraFocus, null, t, null);
            try w.raw(",\"target\":{\"type\":\"board\"},\"params\":{\"priority\":1}");
            try w.close();
            try w.open(ei, .gameEnd, null, t + 0.3 * adv, null);
            try w.raw(",\"target\":{\"type\":\"board\"},\"params\":{\"scores\":[");
            const scores: []const Value = if (ev.object.get("scores")) |x| (if (x == .array) x.array.items else &.{}) else &.{};
            for (scores, 0..) |sv, si| {
                if (si > 0) try w.raw(",");
                try w.print("{d}", .{if (sv == .integer) sv.integer else 0});
            }
            try w.raw("]}");
            try w.close();
        }
        // turnStarted and unknown events produce no clips
    }
    try w.raw("],\"duration\":");
    try w.num(w.end);
    try w.raw("}");
    return w.out.items;
}

// ---------------------------------------------------------------------------

const sample =
    \\[{"type":"turnStarted","player":0,"tile":"fx-cap"},
    \\ {"type":"tilePlaced","player":0,"x":1,"y":0,"rot":2,"tile":"fx-cap"},
    \\ {"type":"figurePlaced","player":0,"x":1,"y":0,"feature":0,"figure":"meeple"},
    \\ {"type":"featureScored","kind":"city","cells":[[0,0],[1,0]],"winners":[0],"points":4,
    \\  "returned":[{"player":0,"x":1,"y":0,"feature":0,"figure":"meeple"}],"final":false},
    \\ {"type":"abbotRecalled","player":1,"x":3,"y":2,"points":5},
    \\ {"type":"tileDiscarded","tile":"fx-road-curve"},
    \\ {"type":"gameEnded","scores":[10,7],"breakdown":[]}]
;

test "timeline: valid JSON, ordered keys, deterministic" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    for ([_][]const u8{ "{\"style\":\"realistic\"}", "{\"style\":\"cartoon\",\"speed\":1.5}", "{\"style\":\"reduced\"}", "" }) |o| {
        const j1 = try timelineJson(a, sample, o);
        const j2 = try timelineJson(a, sample, o);
        try std.testing.expectEqualStrings(j1, j2);
        const v = try std.json.parseFromSliceLeaky(Value, a, j1, .{});
        const clips = v.object.get("clips").?.array.items;
        try std.testing.expect(clips.len >= 10);
        var keys: std.ArrayList([]const u8) = .empty;
        for (clips) |c| {
            const k = c.object.get("key").?.string;
            for (keys.items) |x| try std.testing.expect(!std.mem.eql(u8, x, k));
            try keys.append(a, k);
            const dur = c.object.get("duration").?;
            const d: f64 = if (dur == .float) dur.float else @floatFromInt(dur.integer);
            if (std.mem.indexOf(u8, o, "reduced") != null) {
                const kind = c.object.get("kind").?.string;
                if (!std.mem.eql(u8, kind, "scorePopup") and !std.mem.eql(u8, kind, "gameEnd")) try std.testing.expectEqual(@as(f64, 0), d);
            }
        }
    }
}

test "timeline: wall extrude only for tiles with a city; popup at the cell centroid" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const j = try timelineJson(a, "[{\"type\":\"tilePlaced\",\"player\":0,\"x\":0,\"y\":0,\"rot\":0,\"tile\":\"fx-road-straight\"}]", "");
    try std.testing.expect(std.mem.indexOf(u8, j, "wallExtrude") == null);
    const j2 = try timelineJson(a, sample, "");
    try std.testing.expect(std.mem.indexOf(u8, j2, "wallExtrude") != null);
    try std.testing.expect(std.mem.indexOf(u8, j2, "\"kind\":\"scorePopup\"") != null);
    try std.testing.expect(std.mem.indexOf(u8, j2, "\"x\":1.000,\"y\":0.500") != null);
}
