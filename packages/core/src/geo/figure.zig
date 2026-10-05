//! Figure geometry: the classic meeple and the 3rd-edition abbot. The shape is
//! defined ONCE here; styles may only change materials, never the outline.
//!
//! Units: figure height = 1. Outline space: x right, y up, feet on y = 0,
//! centred on x = 0. The 3D piece is the outline extruded to a thickness of
//! 0.35 x height with bevelled edges. Poses:
//!   standing: base on y = 0, front face toward +z.
//!   lying:    the farmer on its back (3rd edition): front face up (+y), head
//!             toward -z, resting on y = 0, centred on the origin.

const std = @import("std");
const vec = @import("vec.zig");
const V2 = vec.V2;
const F = vec.F;
const Allocator = std.mem.Allocator;

pub const Kind = enum(u8) { meeple = 0, abbot = 1 };
pub const Pose = enum(u8) { standing = 0, lying = 1 };

pub const THICKNESS: F = 0.35;
pub const BEVEL: F = 0.045;

/// Right half, top (on the axis) to crotch/bottom (on the axis), y up.
fn halfOutline(kind: Kind, out: *std.ArrayList(V2), a: Allocator) !void {
    switch (kind) {
        .meeple => {
            // round head: centre (0, 0.835), r 0.165, from the top down to the neck
            const c = V2.init(0, 0.835);
            const r: F = 0.165;
            var k: usize = 0;
            while (k <= 8) : (k += 1) {
                const ang = std.math.pi / 2.0 - @as(F, @floatFromInt(k)) * (2.25 / 8.0);
                try out.append(a, c.add(V2.init(@cos(ang), @sin(ang)).scale(r)));
            }
            const pts = [_]V2{
                .{ .x = 0.13, .y = 0.70 }, // neck
                .{ .x = 0.30, .y = 0.685 }, // shoulder
                .{ .x = 0.46, .y = 0.67 }, // arm top
                .{ .x = 0.505, .y = 0.635 }, // hand
                .{ .x = 0.50, .y = 0.565 },
                .{ .x = 0.44, .y = 0.535 }, // arm bottom
                .{ .x = 0.24, .y = 0.50 }, // armpit
                .{ .x = 0.215, .y = 0.40 }, // waist
                .{ .x = 0.33, .y = 0.20 }, // thigh
                .{ .x = 0.44, .y = 0.03 }, // leg outer
                .{ .x = 0.43, .y = 0.0 }, // foot outer
                .{ .x = 0.19, .y = 0.0 }, // foot inner
                .{ .x = 0.12, .y = 0.13 }, // inner leg
                .{ .x = 0.0, .y = 0.235 }, // crotch
            };
            try out.appendSlice(a, &pts);
        },
        .abbot => {
            const pts = [_]V2{
                .{ .x = 0.0, .y = 1.0 }, // hood peak
                .{ .x = 0.09, .y = 0.985 },
                .{ .x = 0.17, .y = 0.93 },
                .{ .x = 0.205, .y = 0.84 }, // hood side
                .{ .x = 0.19, .y = 0.75 },
                .{ .x = 0.16, .y = 0.71 }, // hood/shoulder notch
                .{ .x = 0.27, .y = 0.66 }, // shoulder
                .{ .x = 0.32, .y = 0.58 },
                .{ .x = 0.33, .y = 0.45 }, // sleeve
                .{ .x = 0.36, .y = 0.25 }, // robe
                .{ .x = 0.41, .y = 0.06 },
                .{ .x = 0.40, .y = 0.0 }, // hem
                .{ .x = 0.0, .y = 0.0 },
            };
            try out.appendSlice(a, &pts);
        },
    }
}

/// Closed outline polygon (counter-clockwise, y up), smoothed.
pub fn outline(a: Allocator, kind: Kind) ![]V2 {
    var half: std.ArrayList(V2) = .empty;
    try halfOutline(kind, &half, a);
    var ring: std.ArrayList(V2) = .empty;
    // left side bottom->top would be mirror; build clockwise then reverse later
    try ring.appendSlice(a, half.items);
    var i: usize = half.items.len - 1;
    while (i > 1) {
        i -= 1;
        const p = half.items[i];
        try ring.append(a, V2.init(-p.x, p.y));
    }
    // Chaikin smoothing (2 rounds) for rounded, wooden-piece corners; keep
    // the flat feet / hem by re-snapping y ~ 0 points.
    var pts = ring.items;
    for (0..2) |_| {
        var next: std.ArrayList(V2) = .empty;
        for (pts, 0..) |p, k| {
            const q = pts[(k + 1) % pts.len];
            try next.append(a, p.lerp(q, 0.25));
            try next.append(a, p.lerp(q, 0.75));
        }
        pts = next.items;
    }
    var min_y: F = 1;
    var max_y: F = 0;
    for (pts) |p| {
        min_y = @min(min_y, p.y);
        max_y = @max(max_y, p.y);
    }
    for (pts) |*p| {
        if (p.y < min_y + 0.004) p.y = 0 else p.y = (p.y - min_y) / (max_y - min_y);
    }
    if (vec.signedArea(pts) < 0) std.mem.reverse(V2, pts);
    return pts;
}

/// Inset a CCW polygon by d (miter, clamped).
fn inset(a: Allocator, poly: []const V2, d: F) ![]V2 {
    const n = poly.len;
    const out = try a.alloc(V2, n);
    for (poly, 0..) |p, i| {
        const pa = poly[(i + n - 1) % n];
        const pb = poly[(i + 1) % n];
        const n0 = p.sub(pa).norm().perp();
        const n1 = pb.sub(p).norm().perp();
        var nm = n0.add(n1).norm();
        const c = @max(0.45, nm.dot(n0));
        nm = nm.scale(d / c);
        out[i] = p.add(nm); // perp() of a CCW edge points inward
    }
    return out;
}

/// Ear-clipping triangulation of a simple CCW polygon -> index triples.
pub fn triangulate(a: Allocator, poly: []const V2) ![]u32 {
    var idx: std.ArrayList(u32) = .empty;
    for (0..poly.len) |i| try idx.append(a, @intCast(i));
    var tris: std.ArrayList(u32) = .empty;
    var guard: usize = 0;
    while (idx.items.len > 3 and guard < 100000) : (guard += 1) {
        const n = idx.items.len;
        var clipped = false;
        for (0..n) |k| {
            const ia = idx.items[(k + n - 1) % n];
            const ib = idx.items[k];
            const ic = idx.items[(k + 1) % n];
            const pa = poly[ia];
            const pb = poly[ib];
            const pc = poly[ic];
            if (pb.sub(pa).cross(pc.sub(pb)) <= 1e-12) continue; // reflex
            var inside = false;
            for (idx.items) |j| {
                if (j == ia or j == ib or j == ic) continue;
                const p = poly[j];
                if (pb.sub(pa).cross(p.sub(pa)) >= 0 and pc.sub(pb).cross(p.sub(pb)) >= 0 and pa.sub(pc).cross(p.sub(pc)) >= 0) {
                    inside = true;
                    break;
                }
            }
            if (inside) continue;
            try tris.appendSlice(a, &.{ ia, ib, ic });
            _ = idx.orderedRemove(k);
            clipped = true;
            break;
        }
        if (!clipped) {
            // degenerate remainder: fan it
            const ix0 = idx.items[0];
            for (1..idx.items.len - 1) |k| try tris.appendSlice(a, &.{ ix0, idx.items[k], idx.items[k + 1] });
            idx.items.len = 0;
            break;
        }
    }
    if (idx.items.len == 3) try tris.appendSlice(a, idx.items);
    return tris.items;
}

pub const FigureMesh = struct {
    outline: []V2,
    pos: std.ArrayList([3]f32) = .empty,
    nrm: std.ArrayList([3]f32) = .empty,
    uv: std.ArrayList([2]f32) = .empty,
    indices: std.ArrayList(u32) = .empty,
};

fn transform(pose: Pose, p: [3]F) [3]F {
    return switch (pose) {
        .standing => p,
        // on its back: (x, y, z) -> (x, z + T/2, -(y - 0.5))
        .lying => .{ p[0], p[2] + THICKNESS / 2, -(p[1] - 0.5) },
    };
}

fn transformN(pose: Pose, n: [3]F) [3]F {
    return switch (pose) {
        .standing => n,
        .lying => .{ n[0], n[2], -n[1] },
    };
}

fn f3(p: [3]F) [3]f32 {
    return .{ @floatCast(p[0]), @floatCast(p[1]), @floatCast(p[2]) };
}

pub fn build(a: Allocator, kind: Kind, pose: Pose) !FigureMesh {
    const outer = try outline(a, kind);
    var fm = FigureMesh{ .outline = outer };
    const inner = try inset(a, outer, BEVEL);
    const n = outer.len;
    const hz = THICKNESS / 2;
    const zs = hz - BEVEL; // where the straight side ends

    const addV = struct {
        fn f(al: Allocator, m: *FigureMesh, ps: Pose, p: [3]F, nr: [3]F, uv: [2]F) !u32 {
            try m.pos.append(al, f3(transform(ps, p)));
            const tn = transformN(ps, nr);
            const l = @sqrt(tn[0] * tn[0] + tn[1] * tn[1] + tn[2] * tn[2]);
            try m.nrm.append(al, f3(.{ tn[0] / l, tn[1] / l, tn[2] / l }));
            try m.uv.append(al, .{ @floatCast(uv[0]), @floatCast(uv[1]) });
            return @intCast(m.pos.items.len - 1);
        }
    }.f;
    // Orient a triangle so its geometric normal agrees with vertex normal of the first vertex.
    const tri = struct {
        fn f(al: Allocator, m: *FigureMesh, ix0: u32, ix1: u32, ix2: u32) !void {
            const p0 = m.pos.items[ix0];
            const p1 = m.pos.items[ix1];
            const p2 = m.pos.items[ix2];
            const e1 = [3]f32{ p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2] };
            const e2 = [3]f32{ p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2] };
            const c = [3]f32{ e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0] };
            const nr = m.nrm.items[ix0];
            if (c[0] * nr[0] + c[1] * nr[1] + c[2] * nr[2] >= 0) try m.indices.appendSlice(al, &.{ ix0, ix1, ix2 }) else try m.indices.appendSlice(al, &.{ ix0, ix2, ix1 });
        }
    }.f;

    // smooth outward 2D normals of the outline
    const on = try a.alloc(V2, n);
    for (outer, 0..) |p, i| {
        const pa = outer[(i + n - 1) % n];
        const pb = outer[(i + 1) % n];
        on[i] = p.sub(pa).norm().perp().add(pb.sub(p).norm().perp()).norm().scale(-1);
    }
    const tris = try triangulate(a, inner);

    for ([_]F{ 1, -1 }) |sgn| {
        // flat face on the inset polygon
        const base: u32 = @intCast(fm.pos.items.len);
        for (inner) |p| _ = try addV(a, &fm, pose, .{ p.x, p.y, sgn * hz }, .{ 0, 0, sgn }, .{ p.x + 0.5, 1 - p.y });
        var k: usize = 0;
        while (k < tris.len) : (k += 3) try tri(a, &fm, base + tris[k], base + tris[k + 1], base + tris[k + 2]);
        // bevel ring: inset edge (z = +-hz) -> outer edge (z = +-zs)
        const b0: u32 = @intCast(fm.pos.items.len);
        for (inner, 0..) |p, i| {
            const nr = [3]F{ on[i].x * 0.7, on[i].y * 0.7, sgn * 0.7 };
            _ = try addV(a, &fm, pose, .{ p.x, p.y, sgn * hz }, nr, .{ p.x + 0.5, 1 - p.y });
            _ = try addV(a, &fm, pose, .{ outer[i].x, outer[i].y, sgn * zs }, nr, .{ outer[i].x + 0.5, 1 - outer[i].y });
        }
        for (0..n) |i| {
            const j = (i + 1) % n;
            const ia: u32 = b0 + @as(u32, @intCast(2 * i));
            const ja: u32 = b0 + @as(u32, @intCast(2 * j));
            try tri(a, &fm, ia, ia + 1, ja);
            try tri(a, &fm, ja, ia + 1, ja + 1);
        }
    }
    // straight side band
    const s0: u32 = @intCast(fm.pos.items.len);
    var acc: F = 0;
    for (outer, 0..) |p, i| {
        if (i > 0) acc += p.dist(outer[i - 1]);
        _ = try addV(a, &fm, pose, .{ p.x, p.y, zs }, .{ on[i].x, on[i].y, 0 }, .{ acc, 0 });
        _ = try addV(a, &fm, pose, .{ p.x, p.y, -zs }, .{ on[i].x, on[i].y, 0 }, .{ acc, 1 });
    }
    for (0..n) |i| {
        const j = (i + 1) % n;
        const ia: u32 = s0 + @as(u32, @intCast(2 * i));
        const ja: u32 = s0 + @as(u32, @intCast(2 * j));
        try tri(a, &fm, ia, ia + 1, ja);
        try tri(a, &fm, ja, ia + 1, ja + 1);
    }
    return fm;
}

test "figure outlines are simple CCW polygons and meshes are valid" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    for ([_]Kind{ .meeple, .abbot }) |k| {
        const o = try outline(a, k);
        try std.testing.expect(vec.signedArea(o) > 0.2);
        // no self-intersections
        for (o, 0..) |p, i| {
            const q = o[(i + 1) % o.len];
            for (o, 0..) |r, j| {
                if (j == i or (j + 1) % o.len == i or (i + 1) % o.len == j) continue;
                const s = o[(j + 1) % o.len];
                if (vec.segIntersect(p, q, r, s)) |h| {
                    if (h.t > 1e-6 and h.t < 1 - 1e-6) return error.SelfIntersecting;
                }
            }
        }
        for ([_]Pose{ .standing, .lying }) |ps| {
            const m = try build(a, k, ps);
            try std.testing.expect(m.indices.items.len % 3 == 0);
            for (m.indices.items) |i| try std.testing.expect(i < m.pos.items.len);
            var min_y: f32 = 10;
            for (m.pos.items) |p| min_y = @min(min_y, p[1]);
            try std.testing.expectApproxEqAbs(@as(f32, 0), min_y, 1e-4);
            // front face triangles cover the inset outline area
            const tri_count = m.indices.items.len / 3;
            try std.testing.expect(tri_count > o.len * 4);
        }
    }
}
