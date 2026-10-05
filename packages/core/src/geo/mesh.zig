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

pub const CITY_H: F = 0.018;
pub const WALL_H: F = 0.055;
pub const WALL_HT: F = 0.011;
pub const WATER_Y: F = -0.007;
pub const RIVER_BED: F = -0.022;
pub const ROAD_Y: F = -0.002;
pub const RUT_D: F = 0.004;
const EDGE_BLEND: F = 0.1;

pub const Material = enum(u32) { terrain = 0, wall = 1, water = 2 };

pub const Prop = enum(u8) { tower, house, chapel, tree, sheep, cow, cart, mill, fountain, crop, duck, bridge };

pub const Vertex = struct { pos: [3]f32, nrm: [3]f32, uv: [2]f32, feature: u8 };
pub const Group = struct { start: u32, count: u32, material: Material };
pub const PropInst = struct { prop: Prop, feature: u8, variant: u16 = 0, pos: [3]f32, yaw: f32, scale: f32 };

pub const Mesh = struct {
    verts: std.ArrayList(Vertex) = .empty,
    indices: std.ArrayList(u32) = .empty,
    groups: std.ArrayList(Group) = .empty,
    props: std.ArrayList(PropInst) = .empty,
    anchors: [][3]f32 = &.{},
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
        .city => CITY_H * vec.smoothstep(0, 0.12, @min(u, 1 - u)),
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

pub fn build(a: Allocator, L: *const layout.Layout, resolution: u32) !Mesh {
    var m = Mesh{};
    const R: u32 = std.math.clamp(resolution, 4, 128);

    // Terrain grid ------------------------------------------------------------
    const start0: u32 = 0;
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
    try m.groups.append(a, .{ .start = start0, .count = @intCast(m.indices.items.len), .material = .terrain });

    // Walls -------------------------------------------------------------------
    const wall_start: u32 = @intCast(m.indices.items.len);
    for (L.lines.items) |l| if (l.kind == .wall) try addWall(a, &m, L, l);
    if (m.indices.items.len > wall_start)
        try m.groups.append(a, .{ .start = wall_start, .count = @intCast(m.indices.items.len - wall_start), .material = .wall });

    // Water -------------------------------------------------------------------
    const water_start: u32 = @intCast(m.indices.items.len);
    for (L.lines.items) |l| if (l.kind == .river) try addStrip(a, &m, l.pts, l.hw, WATER_Y, l.feature);
    for (L.ponds.items) |d| try addFan(a, &m, d.center, d.pts, WATER_Y, d.feature);
    if (m.indices.items.len > water_start)
        try m.groups.append(a, .{ .start = water_start, .count = @intCast(m.indices.items.len - water_start), .material = .water });

    try scatterProps(a, &m, L);

    // 3D anchors --------------------------------------------------------------
    m.anchors = try a.alloc([3]f32, L.anchors.len);
    for (L.anchors, 0..) |p0, fi| {
        var p = p0;
        if (L.kind(@intCast(fi)) == .cloister) p = p.add(V2.init(0, layout.CLOISTER_HALF + 0.035));
        var y = height(L, p);
        if (L.kind(@intCast(fi)) == .river) y = WATER_Y;
        m.anchors[fi] = v3(p.x, y, p.y);
    }
    return m;
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

fn addWall(a: Allocator, m: *Mesh, L: *const layout.Layout, l: layout.Line) !void {
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
    for (0..n - 1) |i| {
        const bl0 = height(L, left[i]) - 0.01;
        const bl1 = height(L, left[i + 1]) - 0.01;
        const br0 = height(L, right[i]) - 0.01;
        const br1 = height(L, right[i + 1]) - 0.01;
        const dir = l.pts[i + 1].sub(l.pts[i]).norm();
        const out = dir.perp().scale(-1); // toward the field
        const ua: f32 = @floatCast(arc[i]);
        const ub: f32 = @floatCast(arc[i + 1]);
        const tv: f32 = @floatCast(WALL_H);
        // outer face
        try pushQuad(a, m, .{ v3(right[i].x, br0, right[i].y), v3(right[i + 1].x, br1, right[i + 1].y), v3(right[i + 1].x, top, right[i + 1].y), v3(right[i].x, top, right[i].y) }, v3(out.x, 0, out.y), .{ .{ ua, 0 }, .{ ub, 0 }, .{ ub, tv }, .{ ua, tv } }, f);
        // inner face
        try pushQuad(a, m, .{ v3(left[i].x, bl0, left[i].y), v3(left[i + 1].x, bl1, left[i + 1].y), v3(left[i + 1].x, top, left[i + 1].y), v3(left[i].x, top, left[i].y) }, v3(-out.x, 0, -out.y), .{ .{ ua, 0 }, .{ ub, 0 }, .{ ub, tv }, .{ ua, tv } }, f);
        // top
        try pushQuad(a, m, .{ v3(right[i].x, top, right[i].y), v3(right[i + 1].x, top, right[i + 1].y), v3(left[i + 1].x, top, left[i + 1].y), v3(left[i].x, top, left[i].y) }, v3(0, 1, 0), .{ .{ ua, 0 }, .{ ub, 0 }, .{ ub, 0.02 }, .{ ua, 0.02 } }, f);
    }
    // towers: near both ends and spaced along the wall
    const total = arc[n - 1];
    var rng = vec.Rng.init(vec.mix(L.seed, 0x7077 + @as(u64, f)));
    const inset: F = 0.05;
    var s: F = inset;
    const count: usize = @max(1, @as(usize, @intFromFloat(@floor((total - 2 * inset) / 0.3))));
    const step = (total - 2 * inset) / @as(F, @floatFromInt(count));
    for (0..count + 1) |_| {
        const at = vec.polylineAt(l.pts, s / total);
        const p = at.p.add(at.t.perp().scale(WALL_HT * 0.6));
        try m.props.append(a, .{ .prop = .tower, .feature = f, .variant = @intCast(rng.next() % 3), .pos = v3(p.x, height(L, p), p.y), .yaw = @floatCast(std.math.atan2(at.t.x, at.t.y)), .scale = 1 });
        s += step;
    }
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
        const r0 = l0 + 1;
        const l1 = l0 + 2;
        const r1 = l0 + 3;
        try pushTriUp(a, m, l0, r0, l1);
        try pushTriUp(a, m, l1, r0, r1);
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

fn clearOfMarks(L: *const layout.Layout, p: V2, r: F) bool {
    for (L.anchors) |q| if (p.dist(q) < r) return false;
    for (L.pennants.items) |q| if (p.dist(q.p) < r * 0.8) return false;
    for (L.buildings.items) |b| if (p.dist(b.center) < b.half * 1.45 + 0.03) return false;
    return true;
}

fn borderDist(p: V2) F {
    return @min(@min(p.x, p.y), @min(1 - p.x, 1 - p.y));
}

fn put(a: Allocator, m: *Mesh, L: *const layout.Layout, prop: Prop, f: u8, variant: u16, p: V2, y_off: F, yaw: F, scale: F) !void {
    try m.props.append(a, .{ .prop = prop, .feature = f, .variant = variant, .pos = v3(p.x, height(L, p) + y_off, p.y), .yaw = @floatCast(yaw), .scale = @floatCast(scale) });
}

fn scatterProps(a: Allocator, m: *Mesh, L: *const layout.Layout) !void {
    var rng = vec.Rng.init(vec.mix(L.seed, 0x9409));
    const tau = 2 * std.math.pi;

    // buildings first (they matter most)
    for (L.buildings.items) |b| {
        if (b.kind == .cloister) {
            var yaw: F = 0;
            for (L.lines.items) |l| if (l.kind == .road and l.pts[l.pts.len - 1].dist(b.center) < 1e-6) {
                const dir = l.pts[0].sub(b.center);
                yaw = std.math.atan2(dir.x, dir.y);
            };
            try put(a, m, L, .chapel, b.feature, 0, b.center, 0, yaw, 1);
        } else {
            try put(a, m, L, .fountain, b.feature, 0, b.center, 0, 0, 1);
        }
    }

    // houses in cities, on a jittered grid
    const hs: F = 0.075;
    var gy: F = hs * 0.5;
    while (gy < 1) : (gy += hs) {
        var gx: F = hs * 0.5;
        while (gx < 1) : (gx += hs) {
            const p = V2.init(gx + rng.range(-0.018, 0.018), gy + rng.range(-0.018, 0.018));
            const r = rng.float();
            const variant: u16 = @intCast(rng.next() % 4);
            const yaw = @floor(rng.float() * 4) * tau / 4 + rng.range(-0.15, 0.15);
            const sc = rng.range(0.8, 1.2);
            const f = L.classify(p);
            if (f == NONE or L.kind(f) != .city) continue;
            if (borderDist(p) < 0.035 or r > 0.85) continue;
            var dw: F = 1;
            for (L.lines.items) |l| if (l.kind == .wall) {
                dw = @min(dw, vec.distPointPolyline(p, l.pts));
            };
            if (dw < 0.05 or !clearOfLines(L, p, 0.02) or !clearOfMarks(L, p, 0.07)) continue;
            try put(a, m, L, .house, f, variant, p, 0, yaw, sc);
        }
    }

    // fields: trees, sheep, cows, crops
    const fs: F = 0.09;
    gy = fs * 0.5;
    while (gy < 1) : (gy += fs) {
        var gx: F = fs * 0.5;
        while (gx < 1) : (gx += fs) {
            const p = V2.init(gx + rng.range(-0.03, 0.03), gy + rng.range(-0.03, 0.03));
            const r = rng.float();
            const variant: u16 = @intCast(rng.next() % 4);
            const yaw = rng.float() * tau;
            const sc = rng.range(0.75, 1.25);
            const f = L.classify(p);
            if (f == NONE or L.kind(f) != .field) continue;
            if (borderDist(p) < 0.04 or !clearOfLines(L, p, 0.03) or !clearOfMarks(L, p, 0.075)) continue;
            var dw: F = 1;
            for (L.lines.items) |l| if (l.kind == .wall) {
                dw = @min(dw, vec.distPointPolyline(p, l.pts));
            };
            if (dw < 0.045) continue;
            const prop: ?Prop = if (r < 0.36) .tree else if (r < 0.46) .sheep else if (r < 0.51) .cow else if (r < 0.64) .crop else null;
            if (prop) |pp| try put(a, m, L, pp, f, variant, p, 0, yaw, sc);
        }
    }

    // rivers: a mill or ducks
    for (L.lines.items) |l| {
        if (l.kind != .river) continue;
        const through = @popCount(L.def.features[l.feature].ports) >= 2;
        if (through and rng.float() < 0.5) {
            const at = vec.polylineAt(l.pts, 0.38);
            const side: F = if (rng.float() < 0.5) 1 else -1;
            const p = at.p.add(at.t.perp().scale(side * (l.hw + 0.05)));
            const f = L.classify(p);
            if (f != NONE and L.kind(f) == .field and borderDist(p) > 0.05 and clearOfMarks(L, p, 0.06)) {
                try put(a, m, L, .mill, l.feature, 0, p, 0, std.math.atan2(at.t.x, at.t.y), 1);
                continue;
            }
        }
        const nd: usize = 2 + @as(usize, @intCast(rng.next() % 2));
        for (0..nd) |k| {
            const at = vec.polylineAt(l.pts, 0.25 + 0.2 * @as(F, @floatFromInt(k)) + rng.range(-0.05, 0.05));
            const p = at.p.add(at.t.perp().scale(rng.range(-0.4, 0.4) * l.hw));
            if (borderDist(p) < 0.03 or !clearOfMarks(L, p, 0.05)) continue;
            try m.props.append(a, .{ .prop = .duck, .feature = l.feature, .pos = v3(p.x, WATER_Y, p.y), .yaw = @floatCast(rng.float() * tau), .scale = 1 });
        }
    }
    for (L.ponds.items) |d| {
        if (d.r < 0.1) continue;
        for (0..3) |k| {
            const ang = rng.float() * tau + @as(F, @floatFromInt(k)) * 2.1;
            const p = d.center.add(V2.init(@cos(ang), @sin(ang)).scale(d.r * rng.range(0.25, 0.7)));
            if (!clearOfMarks(L, p, 0.05)) continue;
            try m.props.append(a, .{ .prop = .duck, .feature = d.feature, .pos = v3(p.x, WATER_Y, p.y), .yaw = @floatCast(rng.float() * tau), .scale = 1 });
        }
    }

    // roads: a cart on some through roads; bridges where roads cross rivers
    for (L.lines.items) |l| {
        if (l.kind != .road) continue;
        if (@popCount(L.def.features[l.feature].ports) >= 2 and rng.float() < 0.35) {
            const at = vec.polylineAt(l.pts, 0.3);
            if (clearOfMarks(L, at.p, 0.06)) try put(a, m, L, .cart, l.feature, 0, at.p, 0, std.math.atan2(at.t.x, at.t.y), 1);
        }
        for (L.lines.items) |r| {
            if (r.kind != .river) continue;
            var i: usize = 0;
            while (i + 1 < l.pts.len) : (i += 1) {
                var j: usize = 0;
                while (j + 1 < r.pts.len) : (j += 1) {
                    if (vec.segIntersect(l.pts[i], l.pts[i + 1], r.pts[j], r.pts[j + 1])) |hit| {
                        const p = l.pts[i].lerp(l.pts[i + 1], hit.t);
                        const dir = l.pts[i + 1].sub(l.pts[i]).norm();
                        try m.props.append(a, .{ .prop = .bridge, .feature = l.feature, .pos = v3(p.x, ROAD_Y, p.y), .yaw = @floatCast(std.math.atan2(dir.x, dir.y)), .scale = 1 });
                    }
                }
            }
        }
    }

    // village houses around junction plazas
    for (L.plazas.items) |d| {
        for (0..4) |k| {
            const ang = (@as(F, @floatFromInt(k)) + 0.5) * tau / 4;
            const dir = V2.init(@cos(ang), @sin(ang));
            const p = d.center.add(dir.scale(d.r + 0.065));
            const f = L.classify(p);
            if (f == NONE or L.kind(f) != .field or !clearOfLines(L, p, 0.012) or !clearOfMarks(L, p, 0.06)) continue;
            try put(a, m, L, .house, f, @intCast(rng.next() % 4), p, 0, std.math.atan2(-dir.x, -dir.y), 0.85);
        }
    }
}
