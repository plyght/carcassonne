//! 3D tile geometry (style-agnostic): relief terrain, city walls, water, prop
//! instances and 3D meeple anchors.
//!
//! Space: x = tile x (east), z = tile y (south), y = up. The tile spans
//! [0,1] x [0,1] in x/z (canonical orientation; renderers rotate by `rot`
//! quarter turns clockwise about (0.5, 0.5) when seen from above). Heights
//! are in tile units. Triangles are counter-clockwise seen from +y.

const std = @import("std");
const tile = @import("../engine/tile.zig");
const vec = @import("vec.zig");
const layout = @import("layout.zig");
const V2 = vec.V2;
const F = vec.F;
const Allocator = std.mem.Allocator;
const NONE = layout.NONE;

pub const CITY_H: F = 0.012;
/// Curtain wall height above the city ground (chunky, like the reference miniatures).
pub const WALL_H: F = 0.085;
/// Half thickness of the curtain wall.
pub const WALL_HT: F = 0.019;
pub const WATER_Y: F = -0.007;
pub const RIVER_BED: F = -0.022;
/// Roads are slightly sunken soft-edged ribbons.
pub const ROAD_Y: F = -0.006;
pub const RUT_D: F = 0.0015;
/// Default tile slab thickness (fraction of the tile width).
pub const SLAB_DEFAULT: F = 0.09;
pub const PLINTH_H: F = 0.012;
/// Suggested meeple height (tile units): chunky and readable next to ~0.08 houses,
/// like the wooden pieces in the reference photo.
pub const MEEPLE_H: F = 0.26;
const EDGE_BLEND: F = 0.1;
const GATE_R: F = 0.055;
/// Merlon pitch and height on the wall walk.
const MERLON: F = 0.036;
const MERLON_H: F = 0.016;
/// House footprint radius at scale 1 (models are ~0.11 x 0.07 tile units; packing
/// circles may overlap a little at the corners, like packed medieval houses).
pub const HOUSE_R: F = 0.045;

/// Geometry groups; styles map each to a material.
pub const Material = enum(u32) { terrain = 0, wall = 1, water = 2, slab = 3 };

pub const Prop = enum(u8) {
    tower,
    house,
    chapel,
    tree,
    sheep,
    cow,
    cart,
    mill,
    fountain,
    crop,
    duck,
    bridge,
    bush,
    gatehouse,
    round_tower,
    wall_stairs,
};

pub const Vertex = struct { pos: [3]f32, nrm: [3]f32, uv: [2]f32, feature: u8 };
pub const Group = struct { start: u32, count: u32, material: Material };
pub const PropInst = struct {
    prop: Prop,
    feature: u8,
    /// Model variant index (style packs pick a model per variant, modulo their count).
    variant: u8 = 0,
    /// Tint index into the style's palette for this prop kind.
    tint: u8 = 0,
    pos: [3]f32,
    yaw: f32,
    scale: f32,
    /// Extra vertical scale (houses vary in height).
    height: f32 = 1,
};

/// Figure pose at an anchor: standing (thief/knight/monk), lying (farmer, 3rd ed.).
pub const Pose = enum(u8) { standing = 0, lying = 1 };

pub const Anchor3 = struct { pos: [3]f32, yaw: f32, scale: f32, pose: Pose };

pub const Mesh = struct {
    verts: std.ArrayList(Vertex) = .empty,
    indices: std.ArrayList(u32) = .empty,
    groups: std.ArrayList(Group) = .empty,
    props: std.ArrayList(PropInst) = .empty,
    anchors: []Anchor3 = &.{},
};

// ---------------------------------------------------------------------------
// Height field

fn roadProfile(t: F) F {
    // flattened bed with two cart ruts at +-0.45 hw
    const r1 = @exp(-std.math.pow(F, (t - 0.45) / 0.14, 2));
    const r2 = @exp(-std.math.pow(F, (t + 0.45) / 0.14, 2));
    return ROAD_Y - RUT_D * (r1 + r2);
}

fn riverProfile(t: F) F {
    return RIVER_BED * (1 - t * t);
}

fn applyRoad(h: F, t: F) F {
    const k = 1 - vec.smoothstep(0.85, 1.3, @abs(t));
    return h + (roadProfile(t) - h) * k;
}

fn applyRiver(h: F, t: F) F {
    const at = @abs(t);
    const k = 1 - vec.smoothstep(0.95, 1.45, at);
    return h + (riverProfile(@min(at, 1)) - h) * k;
}

fn edgeHeight(def: *const tile.TileDef, side: u2, u: F) F {
    return switch (def.edgeKind(@enumFromInt(side))) {
        .field => 0,
        .city => CITY_H * vec.smoothstep(0, 0.05, @min(u, 1 - u)),
        .road => applyRoad(0, (u - 0.5) / layout.ROAD_HW),
        .river => applyRiver(0, (u - 0.5) / layout.RIVER_HW),
    };
}

fn fieldNoise(p: V2, seed: u64) F {
    var r = vec.Rng.init(seed);
    const tau = 2 * std.math.pi;
    var s: F = 0;
    for (0..3) |_| {
        const ang = r.float() * tau;
        const fr = 1.5 + r.float() * 2.5;
        const d = V2.init(@cos(ang), @sin(ang));
        s += @sin(tau * (fr * d.dot(p) + r.float()));
    }
    return s / 3.0;
}

fn interiorHeight(L: *const layout.Layout, p: V2) F {
    var h: F = 0.0025 * fieldNoise(p, L.seed);
    if (L.isCity(p)) {
        var dw: F = 1;
        for (L.lines.items) |l| if (l.kind == .wall) {
            dw = @min(dw, vec.distPointPolyline(p, l.pts));
        };
        h += (CITY_H - h) * vec.smoothstep(0, 0.03, dw);
    }
    for (L.ponds.items) |d| h = applyRiver(h, p.dist(d.center) / d.r);
    for (L.lines.items) |l| if (l.kind == .river) {
        h = applyRiver(h, vec.distPointPolyline(p, l.pts) / l.hw);
    };
    for (L.lines.items) |l| if (l.kind == .road) {
        h = applyRoad(h, vec.distPointPolyline(p, l.pts) / l.hw);
    };
    for (L.plazas.items) |d| {
        const k = 1 - vec.smoothstep(0.8, 1.1, p.dist(d.center) / d.r);
        h += (ROAD_Y - h) * k;
    }
    return h;
}

/// Terrain height at p (p inside the tile; outside is mirrored back).
/// On the border the height depends only on the edge kind and the position
/// along the side, so neighbouring tiles share identical border heights.
pub fn height(L: *const layout.Layout, p_in: V2) F {
    var p = p_in;
    if (p.x < 0) p.x = -p.x;
    if (p.y < 0) p.y = -p.y;
    if (p.x > 1) p.x = 2 - p.x;
    if (p.y > 1) p.y = 2 - p.y;
    // distances to N, E, S, W sides and the position along each (clockwise)
    const d = [4]F{ p.y, 1 - p.x, 1 - p.y, p.x };
    const u = [4]F{ p.x, p.y, 1 - p.x, 1 - p.y };
    const e = @min(@min(d[0], d[1]), @min(d[2], d[3]));
    const w = vec.smoothstep(0, EDGE_BLEND, e);
    var hi: F = 0;
    if (w > 0) hi = interiorHeight(L, p);
    if (w >= 1) return hi;
    var num: F = 0;
    var den: F = 0;
    const on_border = e <= 0;
    for (0..4) |s| {
        if (d[s] > EDGE_BLEND * 1.5) continue;
        // exactly on the border: only the touching side(s) count, so the
        // value depends on nothing but that edge
        if (on_border and d[s] > 0) continue;
        const ws = 1.0 / (d[s] * d[s] + 1e-12);
        num += ws * edgeHeight(L.def, @intCast(s), u[s]);
        den += ws;
    }
    const he = if (den > 0) num / den else 0;
    return he + (hi - he) * w;
}

fn normalAt(L: *const layout.Layout, p: V2) [3]f32 {
    const eps: F = 0.002;
    const hx = height(L, V2.init(p.x + eps, p.y)) - height(L, V2.init(p.x - eps, p.y));
    const hz = height(L, V2.init(p.x, p.y + eps)) - height(L, V2.init(p.x, p.y - eps));
    var n = [3]F{ -hx, 2 * eps, -hz };
    const l = @sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]);
    for (&n) |*c| c.* /= l;
    return .{ @floatCast(n[0]), @floatCast(n[1]), @floatCast(n[2]) };
}

fn v3(x: F, y: F, z: F) [3]f32 {
    return .{ @floatCast(x), @floatCast(y), @floatCast(z) };
}

// ---------------------------------------------------------------------------

pub const Options = struct {
    /// Terrain grid quads per side (4..128).
    resolution: u32 = 48,
    /// Slab thickness below y = 0 (tile units); 0 disables the slab.
    slab: F = SLAB_DEFAULT,
};

const Gate = struct { p: V2, dir: V2, road: u8, city: u8 };

pub fn build(a: Allocator, L: *const layout.Layout, opts: Options) !Mesh {
    var m = Mesh{};
    const R: u32 = std.math.clamp(opts.resolution, 4, 128);

    // Terrain grid ------------------------------------------------------------
    for (0..R + 1) |j| for (0..R + 1) |i| {
        const p = V2.init(@as(F, @floatFromInt(i)) / @as(F, @floatFromInt(R)), @as(F, @floatFromInt(j)) / @as(F, @floatFromInt(R)));
        try m.verts.append(a, .{
            .pos = v3(p.x, height(L, p), p.y),
            .nrm = normalAt(L, p),
            .uv = .{ @floatCast(p.x), @floatCast(p.y) },
            .feature = L.classify(p),
        });
    };
    for (0..R) |j| for (0..R) |i| {
        const v00: u32 = @intCast(j * (R + 1) + i);
        const v10 = v00 + 1;
        const v01 = v00 + R + 1;
        const v11 = v01 + 1;
        try m.indices.appendSlice(a, &.{ v00, v01, v10, v10, v01, v11 });
    };
    try m.groups.append(a, .{ .start = 0, .count = @intCast(m.indices.items.len), .material = .terrain });

    // Gates: where a road meets a city wall --------------------------------
    var gates: std.ArrayList(Gate) = .empty;
    for (L.lines.items) |r| {
        if (r.kind != .road) continue;
        for (L.lines.items) |w| {
            if (w.kind != .wall) continue;
            var i: usize = 0;
            while (i + 1 < r.gpts.len) : (i += 1) {
                var j: usize = 0;
                while (j + 1 < w.pts.len) : (j += 1) {
                    const hit = vec.segIntersect(r.gpts[i], r.gpts[i + 1], w.pts[j], w.pts[j + 1]) orelse continue;
                    const p = r.gpts[i].lerp(r.gpts[i + 1], hit.t);
                    var dup = false;
                    for (gates.items) |g| if (g.p.dist(p) < 1e-4) {
                        dup = true;
                    };
                    if (!dup) try gates.append(a, .{ .p = p, .dir = r.gpts[i + 1].sub(r.gpts[i]).norm(), .road = r.feature, .city = w.feature });
                }
            }
        }
    }

    // Masonry: walls, plinths -------------------------------------------------
    const wall_start: u32 = @intCast(m.indices.items.len);
    for (L.lines.items) |l| if (l.kind == .wall) try addWall(a, &m, L, l, gates.items);
    for (L.buildings.items) |b| if (b.kind == .cloister) {
        const h = b.half * 1.25;
        try addBox(a, &m, b.center, V2.init(1, 0), h, h, height(L, b.center) - 0.01, height(L, b.center) + PLINTH_H, b.feature, false);
    };
    if (m.indices.items.len > wall_start)
        try m.groups.append(a, .{ .start = wall_start, .count = @intCast(m.indices.items.len - wall_start), .material = .wall });

    // Water -------------------------------------------------------------------
    const water_start: u32 = @intCast(m.indices.items.len);
    for (L.lines.items) |l| if (l.kind == .river) try addStrip(a, &m, l.pts, l.hw, WATER_Y, l.feature);
    for (L.ponds.items) |d| try addFan(a, &m, d.center, d.pts, WATER_Y, d.feature);
    if (m.indices.items.len > water_start)
        try m.groups.append(a, .{ .start = water_start, .count = @intCast(m.indices.items.len - water_start), .material = .water });

    // Slab (cut sides + bottom) ------------------------------------------------
    if (opts.slab > 0) {
        const slab_start: u32 = @intCast(m.indices.items.len);
        try addSlab(a, &m, R, opts.slab);
        try m.groups.append(a, .{ .start = slab_start, .count = @intCast(m.indices.items.len - slab_start), .material = .slab });
    }

    // Props -------------------------------------------------------------------
    for (gates.items) |g| {
        try m.props.append(a, .{ .prop = .gatehouse, .feature = g.city, .pos = v3(g.p.x, height(L, g.p), g.p.y), .yaw = yawOf(g.dir), .scale = 1 });
    }
    try scatterProps(a, &m, L);

    // 3D anchors --------------------------------------------------------------
    m.anchors = try a.alloc(Anchor3, L.anchors.len);
    var rng = vec.Rng.init(vec.mix(L.seed, 0xA4C));
    for (L.anchors, 0..) |p0, fi| {
        const k = L.kind(@intCast(fi));
        var p = p0;
        var pose: Pose = .standing;
        var y = height(L, p);
        var yaw: F = rng.range(-0.35, 0.35); // roughly facing the viewer (+z)
        switch (k) {
            .cloister => {
                // in front of the chapel, on the plinth
                p = p.add(V2.init(0, layout.CLOISTER_HALF + 0.02));
                y = height(L, p0) + PLINTH_H;
            },
            .field => {
                pose = .lying;
                yaw = rng.float() * 2 * std.math.pi;
            },
            .river => y = WATER_Y,
            .road => {
                // stand along the road
                var best: F = 1;
                for (L.lines.items) |l| if (l.feature == fi and l.kind == .road) {
                    var i: usize = 0;
                    while (i + 1 < l.pts.len) : (i += 1) {
                        const d = vec.distPointSeg(p, l.pts[i], l.pts[i + 1]);
                        if (d < best) {
                            best = d;
                            yaw = yawOf(l.pts[i + 1].sub(l.pts[i]).norm().perp());
                        }
                    }
                };
            },
            else => {},
        }
        m.anchors[fi] = .{ .pos = v3(p.x, y, p.y), .yaw = @floatCast(yaw), .scale = @floatCast(MEEPLE_H), .pose = pose };
    }
    return m;
}

/// Yaw (radians about +y) that turns +z into the 2D direction d (x, y=z).
fn yawOf(d: V2) f32 {
    return @floatCast(std.math.atan2(d.x, d.y));
}

fn clampTile(p: V2) V2 {
    return .{ .x = std.math.clamp(p.x, 0, 1), .y = std.math.clamp(p.y, 0, 1) };
}

fn pushQuad(a: Allocator, m: *Mesh, q: [4][3]f32, n: [3]f32, uvs: [4][2]f32, f: u8) !void {
    const base: u32 = @intCast(m.verts.items.len);
    for (q, 0..) |p, i| try m.verts.append(a, .{ .pos = p, .nrm = n, .uv = uvs[i], .feature = f });
    // q = [b0, b1, t1, t0]; orient so the face normal agrees with n
    const e1 = [3]f32{ q[1][0] - q[0][0], q[1][1] - q[0][1], q[1][2] - q[0][2] };
    const e2 = [3]f32{ q[3][0] - q[0][0], q[3][1] - q[0][1], q[3][2] - q[0][2] };
    const c = [3]f32{ e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0] };
    if (c[0] * n[0] + c[1] * n[1] + c[2] * n[2] >= 0) {
        try m.indices.appendSlice(a, &.{ base, base + 1, base + 3, base + 1, base + 2, base + 3 });
    } else {
        try m.indices.appendSlice(a, &.{ base, base + 3, base + 1, base + 1, base + 3, base + 2 });
    }
}

/// Oriented box: centre c, axis d (unit, along "length"), half extents hl/hw,
/// from y0 to y1. Sides + top (+ bottom when `bottom`).
fn addBox(a: Allocator, m: *Mesh, c: V2, d: V2, hl: F, hw: F, y0: F, y1: F, f: u8, bottom: bool) !void {
    const s = d.perp();
    const cs = [4]V2{
        c.add(d.scale(-hl)).add(s.scale(-hw)),
        c.add(d.scale(hl)).add(s.scale(-hw)),
        c.add(d.scale(hl)).add(s.scale(hw)),
        c.add(d.scale(-hl)).add(s.scale(hw)),
    };
    for (0..4) |i| {
        const p0 = cs[i];
        const p1 = cs[(i + 1) % 4];
        const mid = p0.lerp(p1, 0.5).sub(c).norm();
        try pushQuad(a, m, .{ v3(p0.x, y0, p0.y), v3(p1.x, y0, p1.y), v3(p1.x, y1, p1.y), v3(p0.x, y1, p0.y) }, v3(mid.x, 0, mid.y), .{ .{ 0, 0 }, .{ 1, 0 }, .{ 1, 1 }, .{ 0, 1 } }, f);
    }
    try pushQuad(a, m, .{ v3(cs[0].x, y1, cs[0].y), v3(cs[1].x, y1, cs[1].y), v3(cs[2].x, y1, cs[2].y), v3(cs[3].x, y1, cs[3].y) }, .{ 0, 1, 0 }, .{ .{ 0, 0 }, .{ 1, 0 }, .{ 1, 1 }, .{ 0, 1 } }, f);
    if (bottom) try pushQuad(a, m, .{ v3(cs[0].x, y0, cs[0].y), v3(cs[1].x, y0, cs[1].y), v3(cs[2].x, y0, cs[2].y), v3(cs[3].x, y0, cs[3].y) }, .{ 0, -1, 0 }, .{ .{ 0, 0 }, .{ 1, 0 }, .{ 1, 1 }, .{ 0, 1 } }, f);
}

fn nearGate(gates: []const Gate, p: V2) bool {
    for (gates) |g| if (g.p.dist(p) < GATE_R) return true;
    return false;
}

fn addWall(a: Allocator, m: *Mesh, L: *const layout.Layout, l: layout.Line, gates: []const Gate) !void {
    const n = l.pts.len;
    const left = try a.alloc(V2, n); // city side
    const right = try a.alloc(V2, n); // field side
    const arc = try a.alloc(F, n);
    var acc: F = 0;
    for (l.pts, 0..) |p, i| {
        if (i > 0) acc += p.dist(l.pts[i - 1]);
        arc[i] = acc;
        const d0 = if (i > 0) p.sub(l.pts[i - 1]).norm() else l.pts[1].sub(p).norm();
        const d1 = if (i + 1 < n) l.pts[i + 1].sub(p).norm() else d0;
        const nr = d0.add(d1).norm().perp();
        const c = p.add(nr.scale(WALL_HT * 0.6)); // sit slightly inside the city
        left[i] = clampTile(c.add(nr.scale(WALL_HT)));
        right[i] = clampTile(c.sub(nr.scale(WALL_HT)));
    }
    const top: F = CITY_H + WALL_H;
    const f = l.feature;
    const tv: f32 = @floatCast(WALL_H);
    for (0..n - 1) |i| {
        if (nearGate(gates, l.pts[i].lerp(l.pts[i + 1], 0.5))) continue; // gatehouse opening
        const bl0 = height(L, left[i]) - 0.01;
        const bl1 = height(L, left[i + 1]) - 0.01;
        const br0 = height(L, right[i]) - 0.01;
        const br1 = height(L, right[i + 1]) - 0.01;
        const dir = l.pts[i + 1].sub(l.pts[i]).norm();
        const out = dir.perp().scale(-1); // toward the field
        const ua: f32 = @floatCast(arc[i]);
        const ub: f32 = @floatCast(arc[i + 1]);
        try pushQuad(a, m, .{ v3(right[i].x, br0, right[i].y), v3(right[i + 1].x, br1, right[i + 1].y), v3(right[i + 1].x, top, right[i + 1].y), v3(right[i].x, top, right[i].y) }, v3(out.x, 0, out.y), .{ .{ ua, 0 }, .{ ub, 0 }, .{ ub, tv }, .{ ua, tv } }, f);
        try pushQuad(a, m, .{ v3(left[i].x, bl0, left[i].y), v3(left[i + 1].x, bl1, left[i + 1].y), v3(left[i + 1].x, top, left[i + 1].y), v3(left[i].x, top, left[i].y) }, v3(-out.x, 0, -out.y), .{ .{ ua, 0 }, .{ ub, 0 }, .{ ub, tv }, .{ ua, tv } }, f);
        try pushQuad(a, m, .{ v3(right[i].x, top, right[i].y), v3(right[i + 1].x, top, right[i + 1].y), v3(left[i + 1].x, top, left[i + 1].y), v3(left[i].x, top, left[i].y) }, v3(0, 1, 0), .{ .{ ua, 0 }, .{ ub, 0 }, .{ ub, 0.02 }, .{ ua, 0.02 } }, f);
    }
    // crenellations: merlons on the field-side half of the wall walk
    const total = arc[n - 1];
    const merlon: F = MERLON;
    var s: F = merlon * 0.5;
    while (s < total) : (s += merlon) {
        const at = vec.polylineAt(l.pts, s / total);
        if (nearGate(gates, at.p) or vec.borderDistance(at.p) < 0.02) continue;
        const outn = at.t.perp().scale(-1);
        const c = at.p.add(at.t.perp().scale(WALL_HT * 0.6)).add(outn.scale(WALL_HT * 0.55));
        try addBox(a, m, c, at.t, merlon * 0.3, WALL_HT * 0.42, top, top + MERLON_H, f, false);
    }

    // towers: near both ends and at joints; square and round alternate
    var rng = vec.Rng.init(vec.mix(L.seed, 0x7077 + @as(u64, f)));
    const inset: F = 0.045;
    const count: usize = @max(1, @as(usize, @intFromFloat(@floor((total - 2 * inset) / 0.26))));
    const step = (total - 2 * inset) / @as(F, @floatFromInt(count));
    s = inset;
    for (0..count + 1) |k| {
        const at = vec.polylineAt(l.pts, s / total);
        s += step;
        const p = at.p.add(at.t.perp().scale(WALL_HT * 0.6));
        if (nearGate(gates, p)) continue;
        const round = (k + @as(usize, @intCast(rng.next() % 2))) % 2 == 0;
        try m.props.append(a, .{ .prop = if (round) .round_tower else .tower, .feature = f, .variant = @intCast(rng.next() % 3), .tint = @intCast(rng.next() % 4), .pos = v3(p.x, height(L, p), p.y), .yaw = yawOf(at.t), .scale = 1, .height = @floatCast(rng.range(0.9, 1.25)) });
    }
    // one set of stairs up the inner face of longer walls
    if (total > 0.5 and rng.float() < 0.7) {
        const at = vec.polylineAt(l.pts, 0.32);
        const p = at.p.add(at.t.perp().scale(WALL_HT * 2.4));
        if (!nearGate(gates, p) and L.classify(p) == f) try m.props.append(a, .{ .prop = .wall_stairs, .feature = f, .pos = v3(p.x, height(L, p), p.y), .yaw = yawOf(at.t), .scale = 1 });
    }
}

/// Cut sides + bottom of the tile slab. The top edge follows the terrain
/// border heights (which depend only on the edge kind), so slabs of
/// neighbouring tiles meet flush.
fn addSlab(a: Allocator, m: *Mesh, R: u32, thick: F) !void {
    const y0: f32 = @floatCast(-thick);
    const tv: f32 = @floatCast(thick);
    for (0..4) |side| {
        for (0..R) |q| {
            const vi = struct {
                fn idx(sd: usize, k: usize, r: u32) u32 {
                    const rr: usize = r;
                    const ij: [2]usize = switch (sd) {
                        0 => .{ k, 0 },
                        1 => .{ rr, k },
                        2 => .{ rr - k, rr },
                        else => .{ 0, rr - k },
                    };
                    return @intCast(ij[1] * (rr + 1) + ij[0]);
                }
            }.idx;
            const t0 = m.verts.items[vi(side, q, R)].pos;
            const t1 = m.verts.items[vi(side, q + 1, R)].pos;
            const n: [3]f32 = switch (side) {
                0 => .{ 0, 0, -1 },
                1 => .{ 1, 0, 0 },
                2 => .{ 0, 0, 1 },
                else => .{ -1, 0, 0 },
            };
            const ua: f32 = @as(f32, @floatFromInt(q)) / @as(f32, @floatFromInt(R));
            const ub: f32 = @as(f32, @floatFromInt(q + 1)) / @as(f32, @floatFromInt(R));
            try pushQuad(a, m, .{ .{ t0[0], y0, t0[2] }, .{ t1[0], y0, t1[2] }, t1, t0 }, n, .{ .{ ua, tv }, .{ ub, tv }, .{ ub, 0 }, .{ ua, 0 } }, NONE);
        }
    }
    try pushQuad(a, m, .{ .{ 0, y0, 0 }, .{ 1, y0, 0 }, .{ 1, y0, 1 }, .{ 0, y0, 1 } }, .{ 0, -1, 0 }, .{ .{ 0, 0 }, .{ 1, 0 }, .{ 1, 1 }, .{ 0, 1 } }, NONE);
}

fn addStrip(a: Allocator, m: *Mesh, pts: []const V2, hw: F, y: F, f: u8) !void {
    const n = pts.len;
    const base: u32 = @intCast(m.verts.items.len);
    const band = try layout.bandPolygon(a, pts, hw);
    const total = vec.polylineLength(pts);
    var acc: F = 0;
    for (0..n) |i| {
        if (i > 0) acc += pts[i].dist(pts[i - 1]);
        const l = clampTile(band[i]);
        const r = clampTile(band[2 * n - 1 - i]);
        const u: f32 = @floatCast(acc / total);
        try m.verts.append(a, .{ .pos = v3(l.x, y, l.y), .nrm = .{ 0, 1, 0 }, .uv = .{ u, 0 }, .feature = f });
        try m.verts.append(a, .{ .pos = v3(r.x, y, r.y), .nrm = .{ 0, 1, 0 }, .uv = .{ u, 1 }, .feature = f });
    }
    for (0..n - 1) |i| {
        const l0 = base + @as(u32, @intCast(i * 2));
        try pushTriUp(a, m, l0, l0 + 1, l0 + 2);
        try pushTriUp(a, m, l0 + 2, l0 + 1, l0 + 3);
    }
}

/// Append triangle oriented so its normal points +y.
fn pushTriUp(a: Allocator, m: *Mesh, ia: u32, ib: u32, ic: u32) !void {
    const p0 = m.verts.items[ia].pos;
    const p1 = m.verts.items[ib].pos;
    const p2 = m.verts.items[ic].pos;
    const ny = (p1[2] - p0[2]) * (p2[0] - p0[0]) - (p1[0] - p0[0]) * (p2[2] - p0[2]);
    if (ny >= 0) try m.indices.appendSlice(a, &.{ ia, ib, ic }) else try m.indices.appendSlice(a, &.{ ia, ic, ib });
}

fn addFan(a: Allocator, m: *Mesh, c: V2, ring: []const V2, y: F, f: u8) !void {
    const base: u32 = @intCast(m.verts.items.len);
    try m.verts.append(a, .{ .pos = v3(c.x, y, c.y), .nrm = .{ 0, 1, 0 }, .uv = .{ 0.5, 0.5 }, .feature = f });
    for (ring) |p0| {
        const p = clampTile(p0);
        try m.verts.append(a, .{ .pos = v3(p.x, y, p.y), .nrm = .{ 0, 1, 0 }, .uv = .{ @floatCast(p.x), @floatCast(p.y) }, .feature = f });
    }
    const n: u32 = @intCast(ring.len);
    for (0..n) |i| {
        const k: u32 = @intCast(i);
        try pushTriUp(a, m, base, base + 1 + k, base + 1 + (k + 1) % n);
    }
}

// ---------------------------------------------------------------------------
// Props

fn clearOfLines(L: *const layout.Layout, p: V2, extra: F) bool {
    for (L.lines.items) |l| {
        const d = vec.distPointPolyline(p, l.pts);
        if (d < l.hw + extra) return false;
    }
    for (L.ponds.items) |d| if (p.dist(d.center) < d.r + extra) return false;
    for (L.plazas.items) |d| if (p.dist(d.center) < d.r + extra * 0.5) return false;
    return true;
}

/// Keep meeple spots, pennants and buildings free (meeples are big).
fn clearOfMarks(L: *const layout.Layout, p: V2, r: F) bool {
    for (L.anchors) |q| if (p.dist(q) < r) return false;
    for (L.pennants.items) |q| if (p.dist(q.p) < r * 0.6) return false;
    for (L.buildings.items) |b| if (p.dist(b.center) < b.half * 1.45 + 0.03) return false;
    return true;
}

fn wallDist(L: *const layout.Layout, p: V2) F {
    var dw: F = 1;
    for (L.lines.items) |l| if (l.kind == .wall) {
        dw = @min(dw, vec.distPointPolyline(p, l.pts));
    };
    return dw;
}

fn put(a: Allocator, m: *Mesh, L: *const layout.Layout, prop: Prop, f: u8, rng: *vec.Rng, p: V2, yaw: F, scale: F) !void {
    try m.props.append(a, .{
        .prop = prop,
        .feature = f,
        .variant = @intCast(rng.next() % 4),
        .tint = @intCast(rng.next() % 4),
        .pos = v3(p.x, height(L, p), p.y),
        .yaw = @floatCast(yaw),
        .scale = @floatCast(scale),
    });
}

const House = struct { p: V2, r: F };

/// Unit tangent of the nearest city wall to p (null when there is no wall).
fn wallTangent(L: *const layout.Layout, p: V2) ?V2 {
    var best: F = 1e9;
    var t: ?V2 = null;
    for (L.lines.items) |l| if (l.kind == .wall) {
        var i: usize = 0;
        while (i + 1 < l.pts.len) : (i += 1) {
            const d = vec.distPointSeg(p, l.pts[i], l.pts[i + 1]);
            if (d < best) {
                best = d;
                t = l.pts[i + 1].sub(l.pts[i]).norm();
            }
        }
    };
    return t;
}

/// One to three small bushes around p, all on field feature f.
fn bushCluster(a: Allocator, m: *Mesh, L: *const layout.Layout, rng: *vec.Rng, f: u8, p: V2, clear: F) !void {
    const tau = 2 * std.math.pi;
    const n: usize = 1 + @as(usize, @intCast(rng.next() % 3));
    for (0..n) |k| {
        const q = if (k == 0) p else p.add(V2.init(rng.range(-0.022, 0.022), rng.range(-0.022, 0.022)));
        if (L.classify(q) != f or vec.borderDistance(q) < 0.02 or !clearOfLines(L, q, 0.01) or !clearOfMarks(L, q, clear)) continue;
        if (wallDist(L, q) < WALL_HT + 0.02) continue;
        try put(a, m, L, .bush, f, rng, q, rng.float() * tau, rng.range(0.7, 1.25));
    }
}

fn scatterProps(a: Allocator, m: *Mesh, L: *const layout.Layout) !void {
    var rng = vec.Rng.init(vec.mix(L.seed, 0x9409));
    const tau = 2 * std.math.pi;

    for (L.buildings.items) |b| {
        if (b.kind == .cloister) {
            var yaw: F = 0;
            for (L.lines.items) |l| if (l.kind == .road and l.pts[l.pts.len - 1].dist(b.center) < 1e-6) {
                yaw = yawOf(l.pts[0].sub(b.center).norm());
            };
            try m.props.append(a, .{ .prop = .chapel, .feature = b.feature, .pos = v3(b.center.x, height(L, b.center) + PLINTH_H, b.center.y), .yaw = @floatCast(yaw), .scale = @floatCast(b.half * 2 / 0.23) });
        } else {
            try put(a, m, L, .fountain, b.feature, &rng, b.center, 0, 1);
        }
    }

    // Houses: deterministic dart-throwing packing of fewer, much larger
    // houses (no overlaps, clear of walls, roads, the tile border and meeple
    // spots). Irregular gaps leave courtyard ground showing between them.
    // Houses near a wall line up with it, the rest snap to a jittered grid.
    var houses: std.ArrayList(House) = .empty;
    var tries: usize = 0;
    while (tries < 500) : (tries += 1) {
        const p = V2.init(rng.float(), rng.float());
        const sc = rng.range(0.8, 1.3);
        const hgt = rng.range(0.85, 1.5);
        const gap = rng.range(-0.004, 0.02);
        var yaw: F = @floor(rng.float() * 4) * tau / 4 + rng.range(-0.3, 0.3);
        const variant: u8 = @intCast(rng.next() % 6);
        const tint: u8 = @intCast(rng.next() % 4);
        const r = HOUSE_R * sc;
        const f = L.classify(p);
        if (f == NONE or L.kind(f) != .city) continue;
        if (vec.borderDistance(p) < r * 0.85) continue;
        const wd = wallDist(L, p);
        if (wd < r * 0.7 + WALL_HT * 1.6 or !clearOfLines(L, p, r * 0.55) or !clearOfMarks(L, p, 0.09 + r * 0.5)) continue;
        var ok = true;
        for (houses.items) |h| if (h.p.dist(p) < h.r + r + gap) {
            ok = false;
            break;
        };
        if (!ok) continue;
        if (wd < r + 0.06) {
            if (wallTangent(L, p)) |t| yaw = @as(F, yawOf(t)) + (if (rng.float() < 0.5) @as(F, tau / 4.0) else 0) + rng.range(-0.08, 0.08);
        }
        try houses.append(a, .{ .p = p, .r = r });
        try m.props.append(a, .{ .prop = .house, .feature = f, .variant = variant, .tint = tint, .pos = v3(p.x, height(L, p), p.y), .yaw = @floatCast(yaw), .scale = @floatCast(sc), .height = @floatCast(hgt) });
    }

    // Fields: mostly clusters of small dark bushes, a few round trees, sheep,
    // cows and the odd subtle crop strip, on a jittered grid.
    const fs: F = 0.1;
    var gy: F = fs * 0.5;
    while (gy < 1) : (gy += fs) {
        var gx: F = fs * 0.5;
        while (gx < 1) : (gx += fs) {
            const p = V2.init(gx + rng.range(-0.035, 0.035), gy + rng.range(-0.035, 0.035));
            const r = rng.float();
            const yaw = rng.float() * tau;
            const sc = rng.range(0.75, 1.25);
            const f = L.classify(p);
            if (f == NONE or L.kind(f) != .field) continue;
            if (vec.borderDistance(p) < 0.04 or !clearOfLines(L, p, 0.03) or !clearOfMarks(L, p, 0.09)) continue;
            if (wallDist(L, p) < 0.05) continue;
            if (r < 0.1) {
                try bushCluster(a, m, L, &rng, f, p, 0.09);
            } else if (r < 0.125) {
                try put(a, m, L, .tree, f, &rng, p, yaw, sc);
            } else if (r < 0.15) {
                try put(a, m, L, .sheep, f, &rng, p, yaw, sc);
            } else if (r < 0.158) {
                try put(a, m, L, .cow, f, &rng, p, yaw, sc);
            } else if (r < 0.178) {
                try put(a, m, L, .crop, f, &rng, p, yaw, sc);
            }
        }
    }

    // Bushes: small dark clusters along roads, rivers and outside city walls
    for (L.lines.items) |l| {
        const off: F = switch (l.kind) {
            .road => l.hw + 0.024,
            .wall => WALL_HT * 2 + 0.03,
            .river => l.hw + 0.028,
        };
        const total = vec.polylineLength(l.pts);
        var s: F = 0.03 + rng.float() * 0.05;
        while (s < total) : (s += 0.07 + rng.float() * 0.09) {
            if (rng.float() < 0.4) continue;
            const at = vec.polylineAt(l.pts, s / total);
            const side: F = if (l.kind == .wall) -1 else if (rng.float() < 0.5) 1 else -1;
            const p = at.p.add(at.t.perp().scale(side * (off + rng.range(-0.004, 0.012))));
            const f = L.classify(p);
            if (f == NONE or L.kind(f) != .field) continue;
            if (vec.borderDistance(p) < 0.02 or !clearOfLines(L, p, 0.012) or !clearOfMarks(L, p, 0.07) or wallDist(L, p) < WALL_HT + 0.02) continue;
            try bushCluster(a, m, L, &rng, f, p, 0.07);
        }
    }

    // Rivers: a mill or ducks
    for (L.lines.items) |l| {
        if (l.kind != .river) continue;
        const through = @popCount(L.def.features[l.feature].ports) >= 2;
        if (through and rng.float() < 0.5) {
            const at = vec.polylineAt(l.pts, 0.38);
            const side: F = if (rng.float() < 0.5) 1 else -1;
            const p = at.p.add(at.t.perp().scale(side * (l.hw + 0.05)));
            const f = L.classify(p);
            if (f != NONE and L.kind(f) == .field and vec.borderDistance(p) > 0.05 and clearOfMarks(L, p, 0.08)) {
                try put(a, m, L, .mill, l.feature, &rng, p, yawOf(at.t), 1);
                continue;
            }
        }
        const nd: usize = 2 + @as(usize, @intCast(rng.next() % 2));
        for (0..nd) |k| {
            const at = vec.polylineAt(l.pts, 0.25 + 0.2 * @as(F, @floatFromInt(k)) + rng.range(-0.05, 0.05));
            const p = at.p.add(at.t.perp().scale(rng.range(-0.4, 0.4) * l.hw));
            if (vec.borderDistance(p) < 0.03 or !clearOfMarks(L, p, 0.06)) continue;
            try m.props.append(a, .{ .prop = .duck, .feature = l.feature, .pos = v3(p.x, WATER_Y, p.y), .yaw = @floatCast(rng.float() * tau), .scale = 1 });
        }
    }
    for (L.ponds.items) |d| {
        if (d.r < 0.1) continue;
        for (0..3) |k| {
            const ang = rng.float() * tau + @as(F, @floatFromInt(k)) * 2.1;
            const p = d.center.add(V2.init(@cos(ang), @sin(ang)).scale(d.r * rng.range(0.25, 0.7)));
            if (!clearOfMarks(L, p, 0.06)) continue;
            try m.props.append(a, .{ .prop = .duck, .feature = d.feature, .pos = v3(p.x, WATER_Y, p.y), .yaw = @floatCast(rng.float() * tau), .scale = 1 });
        }
    }

    // Roads: a cart on some through roads; bridges where roads cross rivers
    for (L.lines.items) |l| {
        if (l.kind != .road) continue;
        if (@popCount(L.def.features[l.feature].ports) >= 2 and rng.float() < 0.3) {
            const at = vec.polylineAt(l.pts, 0.3);
            if (clearOfMarks(L, at.p, 0.08)) try put(a, m, L, .cart, l.feature, &rng, at.p, yawOf(at.t), 1);
        }
        for (L.lines.items) |r| {
            if (r.kind != .river) continue;
            var i: usize = 0;
            while (i + 1 < l.pts.len) : (i += 1) {
                var j: usize = 0;
                while (j + 1 < r.pts.len) : (j += 1) {
                    if (vec.segIntersect(l.pts[i], l.pts[i + 1], r.pts[j], r.pts[j + 1])) |hit| {
                        const p = l.pts[i].lerp(l.pts[i + 1], hit.t);
                        try m.props.append(a, .{ .prop = .bridge, .feature = l.feature, .pos = v3(p.x, ROAD_Y, p.y), .yaw = yawOf(l.pts[i + 1].sub(l.pts[i]).norm()), .scale = 1 });
                    }
                }
            }
        }
    }

    // Village houses around junction plazas
    for (L.plazas.items) |d| {
        for (0..4) |k| {
            const ang = (@as(F, @floatFromInt(k)) + 0.5) * tau / 4;
            const dir = V2.init(@cos(ang), @sin(ang));
            const p = d.center.add(dir.scale(d.r + 0.07));
            const f = L.classify(p);
            if (f == NONE or L.kind(f) != .field or !clearOfLines(L, p, 0.012) or !clearOfMarks(L, p, 0.08)) continue;
            try m.props.append(a, .{ .prop = .house, .feature = f, .variant = @intCast(rng.next() % 6), .tint = @intCast(rng.next() % 4), .pos = v3(p.x, height(L, p), p.y), .yaw = yawOf(dir.scale(-1)), .scale = 0.72, .height = 1.0 });
        }
    }
}
