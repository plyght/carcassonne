//! Binary encoding of geo output for the WASM boundary. Layout documented in
//! README.md (keep both in sync). Everything little-endian, every section
//! 4-byte aligned, so a copied payload can be viewed with Float32Array etc.

const std = @import("std");
const tile = @import("../engine/tile.zig");
const vec = @import("vec.zig");
const layout = @import("layout.zig");
const mesh = @import("mesh.zig");
const V2 = vec.V2;
const Allocator = std.mem.Allocator;

pub const MAGIC: u32 = 0x4F454743; // "CGEO"
pub const VERSION: u16 = 1;
pub const KIND_2D: u16 = 1;
pub const KIND_3D: u16 = 2;

pub fn tag(comptime s: *const [4]u8) u32 {
    return std.mem.readInt(u32, s, .little);
}

pub const Role = enum(u8) {
    /// filled polygon of the feature (field, city, road band, river band, pond)
    region = 0,
    /// road / river centre line (stroke with `width`)
    centerline = 1,
    /// city wall line (city boundary facing non-city ground)
    wall = 2,
    /// cloister / garden footprint
    building = 3,
    /// junction plaza (feature = one of the roads meeting there)
    plaza = 5,
};

const Section = struct { tag: u32, data: std.ArrayList(u8) = .empty, count: u32 = 0 };

pub const Builder = struct {
    a: Allocator,
    kind: u16,
    /// Fixed storage so `*Section` pointers stay valid while adding sections.
    store: [16]Section = undefined,
    n: usize = 0,

    pub fn init(a: Allocator, kind: u16) Builder {
        return .{ .a = a, .kind = kind };
    }

    pub fn section(self: *Builder, t: u32) !*Section {
        for (self.store[0..self.n]) |*s| if (s.tag == t) return s;
        if (self.n == self.store.len) return error.TooManySections;
        self.store[self.n] = .{ .tag = t };
        self.n += 1;
        return &self.store[self.n - 1];
    }

    pub fn finish(self: *Builder) ![]u8 {
        const n = self.n;
        var off: usize = 16 + 16 * n;
        var total = off;
        for (self.store[0..self.n]) |s| total += std.mem.alignForward(usize, s.data.items.len, 4);
        const out = try self.a.alloc(u8, total);
        @memset(out, 0);
        std.mem.writeInt(u32, out[0..4], MAGIC, .little);
        std.mem.writeInt(u16, out[4..6], VERSION, .little);
        std.mem.writeInt(u16, out[6..8], self.kind, .little);
        std.mem.writeInt(u32, out[8..12], @intCast(total), .little);
        std.mem.writeInt(u32, out[12..16], @intCast(n), .little);
        for (self.store[0..self.n], 0..) |s, i| {
            const h = out[16 + 16 * i ..][0..16];
            std.mem.writeInt(u32, h[0..4], s.tag, .little);
            std.mem.writeInt(u32, h[4..8], @intCast(off), .little);
            std.mem.writeInt(u32, h[8..12], @intCast(s.data.items.len), .little);
            std.mem.writeInt(u32, h[12..16], s.count, .little);
            @memcpy(out[off..][0..s.data.items.len], s.data.items);
            off += std.mem.alignForward(usize, s.data.items.len, 4);
        }
        return out;
    }
};

pub fn putU8(a: Allocator, s: *Section, v: u8) !void {
    try s.data.append(a, v);
}
pub fn putU16(a: Allocator, s: *Section, v: u16) !void {
    var b: [2]u8 = undefined;
    std.mem.writeInt(u16, &b, v, .little);
    try s.data.appendSlice(a, &b);
}
pub fn putU32(a: Allocator, s: *Section, v: u32) !void {
    var b: [4]u8 = undefined;
    std.mem.writeInt(u32, &b, v, .little);
    try s.data.appendSlice(a, &b);
}
pub fn putF32(a: Allocator, s: *Section, v: f64) !void {
    const f: f32 = @floatCast(v);
    try putU32(a, s, @bitCast(f));
}

fn putMeta(a: Allocator, b: *Builder, L: *const layout.Layout) !void {
    const s = try b.section(tag("META"));
    s.count = 1;
    try putF32(a, s, layout.ROAD_HW);
    try putF32(a, s, layout.RIVER_HW);
    try putU32(a, s, @intCast(L.def.features.len));
    try putU8(a, s, @intFromEnum(L.def.special));
    try putU8(a, s, @intFromEnum(L.def.set));
    try putU16(a, s, @intCast(L.def.id.len));
    try s.data.appendSlice(a, L.def.id);
    while (s.data.items.len % 4 != 0) try s.data.append(a, 0);
}

fn putFeatures(a: Allocator, b: *Builder, L: *const layout.Layout) !void {
    const s = try b.section(tag("FEAT"));
    for (L.def.features, 0..) |f, i| {
        try putU8(a, s, @intFromEnum(f.kind));
        try putU8(a, s, f.pennants);
        try putU16(a, s, f.ports);
        try putF32(a, s, L.anchors[i].x);
        try putF32(a, s, L.anchors[i].y);
        s.count += 1;
    }
}

const PathSink = struct {
    a: Allocator,
    paths: *Section,
    pnts: *Section,
    fn add(self: *PathSink, feature: u8, kind: u8, role: Role, closed: bool, width: f64, pts: []const V2) !void {
        try putU8(self.a, self.paths, feature);
        try putU8(self.a, self.paths, @intFromEnum(role));
        try putU8(self.a, self.paths, if (closed) 1 else 0);
        try putU8(self.a, self.paths, kind);
        try putU32(self.a, self.paths, self.pnts.count);
        try putU32(self.a, self.paths, @intCast(pts.len));
        try putF32(self.a, self.paths, width);
        self.paths.count += 1;
        for (pts) |p| {
            try putF32(self.a, self.pnts, p.x);
            try putF32(self.a, self.pnts, p.y);
        }
        self.pnts.count += @intCast(pts.len);
    }
};

/// 2D payload (Classic Board / Blueprint). Paths are emitted in draw order.
pub fn encode2D(a: Allocator, L: *const layout.Layout) ![]u8 {
    var b = Builder.init(a, KIND_2D);
    try putMeta(a, &b, L);
    try putFeatures(a, &b, L);
    var sink = PathSink{ .a = a, .paths = try b.section(tag("PATH")), .pnts = try b.section(tag("PNTS")) };
    const K = struct {
        fn k(x: tile.FeatureKind) u8 {
            return @intFromEnum(x);
        }
    }.k;
    for (L.fields.items) |r| try sink.add(r.feature, K(.field), .region, true, 0, r.pts);
    for ([_]layout.LineKind{ .river, .road }) |lk| {
        if (lk == .river) for (L.ponds.items) |d| try sink.add(d.feature, K(.river), .region, true, 0, d.pts);
        for (L.lines.items) |l| {
            if (l.kind != lk) continue;
            const fk = K(if (lk == .road) .road else .river);
            try sink.add(l.feature, fk, .region, true, 0, try layout.bandPolygon(a, l.pts, l.hw));
            try sink.add(l.feature, fk, .centerline, false, l.hw * 2, l.pts);
        }
        if (lk == .road) for (L.plazas.items) |d| try sink.add(d.feature, K(.road), .plaza, true, 0, d.pts);
    }
    for (L.cities.items) |r| try sink.add(r.feature, K(.city), .region, true, 0, r.pts);
    for (L.lines.items) |l| if (l.kind == .wall) try sink.add(l.feature, K(.city), .wall, false, 0.02, l.pts);
    for (L.buildings.items) |bd| try sink.add(bd.feature, K(bd.kind), .building, true, 0, bd.pts);

    const pen = try b.section(tag("PENN"));
    for (L.pennants.items) |p| {
        try putU8(a, pen, p.feature);
        try putU8(a, pen, 0);
        try putU16(a, pen, 0);
        try putF32(a, pen, p.p.x);
        try putF32(a, pen, p.p.y);
        pen.count += 1;
    }
    return b.finish();
}

/// 3D payload (Tabletop / Cartoon / Diorama).
pub fn encode3D(a: Allocator, L: *const layout.Layout, resolution: u32) ![]u8 {
    var m = try mesh.build(a, L, resolution);
    _ = &m;
    var b = Builder.init(a, KIND_3D);
    try putMeta(a, &b, L);
    try putFeatures(a, &b, L);

    const pos = try b.section(tag("VPOS"));
    const nrm = try b.section(tag("VNRM"));
    const uv = try b.section(tag("VUV0"));
    const fea = try b.section(tag("VFEA"));
    for (m.verts.items) |v| {
        for (v.pos) |x| try putF32(a, pos, x);
        for (v.nrm) |x| try putF32(a, nrm, x);
        for (v.uv) |x| try putF32(a, uv, x);
        try putU8(a, fea, v.feature);
    }
    const nv: u32 = @intCast(m.verts.items.len);
    pos.count = nv;
    nrm.count = nv;
    uv.count = nv;
    fea.count = nv;
    while (fea.data.items.len % 4 != 0) try fea.data.append(a, 0);

    const idx = try b.section(tag("INDX"));
    for (m.indices.items) |i| try putU32(a, idx, i);
    idx.count = @intCast(m.indices.items.len);

    const grp = try b.section(tag("GRUP"));
    for (m.groups.items) |g| {
        try putU32(a, grp, g.start);
        try putU32(a, grp, g.count);
        try putU32(a, grp, @intFromEnum(g.material));
        try putU32(a, grp, 0);
        grp.count += 1;
    }

    const prop = try b.section(tag("PROP"));
    for (m.props.items) |p| {
        try putU8(a, prop, @intFromEnum(p.prop));
        try putU8(a, prop, p.feature);
        try putU16(a, prop, p.variant);
        try putF32(a, prop, p.pos[0]);
        try putF32(a, prop, p.pos[1]);
        try putF32(a, prop, p.pos[2]);
        try putF32(a, prop, p.yaw);
        try putF32(a, prop, p.scale);
        prop.count += 1;
    }

    const anc = try b.section(tag("ANC3"));
    for (m.anchors) |p| {
        try putF32(a, anc, p[0]);
        try putF32(a, anc, p[1]);
        try putF32(a, anc, p[2]);
        anc.count += 1;
    }
    return b.finish();
}

/// Reader used by tests (and as a reference for other decoders).
pub const Reader = struct {
    bytes: []const u8,

    pub fn kind(self: Reader) u16 {
        return std.mem.readInt(u16, self.bytes[6..8], .little);
    }

    pub fn find(self: Reader, t: u32) ?struct { data: []const u8, count: u32 } {
        const n = std.mem.readInt(u32, self.bytes[12..16], .little);
        for (0..n) |i| {
            const h = self.bytes[16 + 16 * i ..][0..16];
            if (std.mem.readInt(u32, h[0..4], .little) != t) continue;
            const off = std.mem.readInt(u32, h[4..8], .little);
            const len = std.mem.readInt(u32, h[8..12], .little);
            return .{ .data = self.bytes[off..][0..len], .count = std.mem.readInt(u32, h[12..16], .little) };
        }
        return null;
    }

    pub fn f32At(data: []const u8, i: usize) f32 {
        return @bitCast(std.mem.readInt(u32, data[i * 4 ..][0..4], .little));
    }
    pub fn u32At(data: []const u8, i: usize) u32 {
        return std.mem.readInt(u32, data[i * 4 ..][0..4], .little);
    }
};
