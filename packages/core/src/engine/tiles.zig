//! Tile catalog: base + river definitions, indexed by a stable `TileIndex`, with
//! precomputed per-rotation lookup tables.
const std = @import("std");
const tile = @import("tile.zig");
const base = @import("tiles_base.zig");
const river = @import("tiles_river.zig");

pub const TileDef = tile.TileDef;
pub const FeatureKind = tile.FeatureKind;
pub const EdgeKind = tile.EdgeKind;
pub const TileIndex = u8;

pub const all = base.tiles ++ river.tiles;
pub const count: usize = all.len;
pub const base_count: usize = base.tiles.len;
/// First river tile index.
pub const river_first: TileIndex = base.tiles.len;

pub const NO_FEATURE: u8 = 0xff;

/// Largest number of features on any tile.
pub const max_features: usize = blk: {
    var m: usize = 0;
    for (all) |t| m = @max(m, t.features.len);
    break :blk m;
};

pub const Rotated = struct {
    /// Edge kind on each (board) side N, E, S, W.
    edges: [4]EdgeKind,
    /// Local feature index at each (board) port, or NO_FEATURE.
    port_feature: [12]u8,
    /// Board sides touched by each feature (bit s = side s).
    feature_sides: [max_features]u4,
    /// Board port mask of each feature.
    feature_ports: [max_features]tile.PortMask,
};

fn computeRotated(t: TileDef, rot: u2) Rotated {
    var r: Rotated = .{
        .edges = undefined,
        .port_feature = @splat(NO_FEATURE),
        .feature_sides = @splat(0),
        .feature_ports = @splat(0),
    };
    for (t.features, 0..) |f, fi| {
        const mask = tile.rotatePorts(f.ports, rot);
        r.feature_ports[fi] = mask;
        for (0..12) |p| {
            if (mask & (@as(tile.PortMask, 1) << @intCast(p)) != 0) {
                r.port_feature[p] = fi;
                r.feature_sides[fi] |= @as(u4, 1) << @intCast(p / 3);
            }
        }
    }
    for (0..4) |s| {
        const fi = r.port_feature[s * 3 + 1];
        r.edges[s] = if (fi == NO_FEATURE) .field else switch (t.features[fi].kind) {
            .city => .city,
            .road => .road,
            .river => .river,
            else => .field,
        };
    }
    return r;
}

pub const rotated: [count][4]Rotated = blk: {
    @setEvalBranchQuota(200_000);
    var out: [count][4]Rotated = undefined;
    for (all, 0..) |t, i| {
        for (0..4) |r| out[i][r] = computeRotated(t, @intCast(r));
    }
    break :blk out;
};

pub fn def(i: TileIndex) *const TileDef {
    return &all[i];
}

pub fn indexOf(id: []const u8) ?TileIndex {
    for (all, 0..) |t, i| {
        if (std.mem.eql(u8, t.id, id)) return @intCast(i);
    }
    return null;
}

pub fn isRiver(i: TileIndex) bool {
    return all[i].set == .river;
}

pub fn indexOfComptime(comptime id: []const u8) TileIndex {
    return comptime indexOf(id) orelse @compileError("unknown tile " ++ id);
}

// ---------------------------------------------------------------- tests

fn ringAdjacent(a: tile.PortMask, b: tile.PortMask) bool {
    // True when some port of `a` is next to some port of `b` around the tile border.
    var p: u4 = 0;
    while (p < 12) : (p += 1) {
        if (a & (@as(tile.PortMask, 1) << p) == 0) continue;
        const nxt: u4 = @intCast((@as(u8, p) + 1) % 12);
        const prv: u4 = @intCast((@as(u8, p) + 11) % 12);
        if (b & (@as(tile.PortMask, 1) << nxt) != 0) return true;
        if (b & (@as(tile.PortMask, 1) << prv) != 0) return true;
    }
    return false;
}

test "tile manifest: 72 base + 12 river, per-type counts, pennants" {
    var base_total: u32 = 0;
    var river_total: u32 = 0;
    var pennants: u32 = 0;
    var gardens: u32 = 0;
    // Counts per letter (garden copies fold into their letter).
    var per_letter: [26]u32 = @splat(0);
    for (all) |t| {
        switch (t.set) {
            .base => base_total += t.count,
            .river => river_total += t.count,
        }
        for (t.features) |f| {
            if (t.set == .base) pennants += @as(u32, f.pennants) * t.count;
            if (f.kind == .garden) gardens += t.count;
        }
        if (t.set == .base) per_letter[t.id[0] - 'A'] += t.count;
    }
    try std.testing.expectEqual(@as(u32, 72), base_total);
    try std.testing.expectEqual(@as(u32, 12), river_total);
    try std.testing.expectEqual(@as(u32, 10), pennants);
    try std.testing.expectEqual(@as(u32, 9), gardens); // 8 base + 1 river
    // WikiCarpedia "Base game" tile distribution.
    const expected = [_]u32{ 2, 4, 1, 4, 5, 2, 1, 3, 2, 3, 3, 3, 2, 3, 2, 3, 1, 3, 2, 1, 8, 9, 4, 1 };
    for (expected, 0..) |e, i| try std.testing.expectEqual(e, per_letter[i]);
    // Exactly one start tile type, one spring, one lake.
    try std.testing.expect(def(indexOfComptime("D")).special == .start);
    try std.testing.expect(def(indexOfComptime("R1")).special == .spring);
    try std.testing.expect(def(indexOfComptime("R12")).special == .lake);
}

test "tile data invariants" {
    for (all) |t| {
        var covered: tile.PortMask = 0;
        for (t.features, 0..) |f, fi| {
            switch (f.kind) {
                .cloister, .garden => try std.testing.expectEqual(@as(tile.PortMask, 0), f.ports),
                .road, .river => {
                    // Roads/rivers only use middle ports.
                    try std.testing.expectEqual(@as(tile.PortMask, 0), f.ports & ~@as(tile.PortMask, 0b010_010_010_010));
                    try std.testing.expect(f.ports != 0);
                },
                .city => {
                    // Cities cover whole sides.
                    for (0..4) |s| {
                        const side: tile.PortMask = @as(tile.PortMask, 0b111) << @intCast(s * 3);
                        const m = f.ports & side;
                        try std.testing.expect(m == 0 or m == side);
                    }
                },
                .field => {
                    // Field adjacency lists must equal the geometric ring adjacency.
                    for (t.features, 0..) |g, gi| {
                        if (g.kind != .city) continue;
                        const listed = std.mem.indexOfScalar(u8, f.adjacent_cities, @intCast(gi)) != null;
                        if (listed != ringAdjacent(f.ports, g.ports)) {
                            std.debug.print("tile {s} field {d} city {d}\n", .{ t.id, fi, gi });
                            return error.BadAdjacency;
                        }
                    }
                },
            }
            try std.testing.expectEqual(@as(tile.PortMask, 0), covered & f.ports);
            covered |= f.ports;
        }
        // Every port belongs to exactly one feature.
        try std.testing.expectEqual(@as(tile.PortMask, 0xfff), covered);
    }
}

test "rotation tables" {
    const u = rotated[indexOfComptime("U")];
    try std.testing.expectEqual(EdgeKind.road, u[0].edges[0]);
    try std.testing.expectEqual(EdgeKind.field, u[0].edges[1]);
    try std.testing.expectEqual(EdgeKind.road, u[1].edges[1]);
    try std.testing.expectEqual(EdgeKind.field, u[1].edges[0]);
    const e = rotated[indexOfComptime("E")];
    // City N rotated once clockwise faces E.
    try std.testing.expectEqual(EdgeKind.city, e[1].edges[1]);
    try std.testing.expectEqual(@as(u4, 0b0010), e[1].feature_sides[0]);
}
