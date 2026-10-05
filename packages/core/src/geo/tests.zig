//! Geo invariants, run over every tile in the registry (fixtures today, the
//! engine's real tiles once registry.zig is switched over).

const std = @import("std");
const tile = @import("../engine/tile.zig");
const vec = @import("vec.zig");
const layout = @import("layout.zig");
const mesh = @import("mesh.zig");
const buffer = @import("buffer.zig");
const registry = @import("registry.zig");
const V2 = vec.V2;
const F = vec.F;
const testing = std.testing;

test "every field/city feature gets a non-empty region and an anchor on it" {
    for (registry.tiles) |*def| {
        var L = try layout.build(testing.allocator, def);
        defer L.deinit();
        for (def.features, 0..) |f, fi| {
            const k: u8 = @intCast(fi);
            if (f.kind == .field or f.kind == .city) {
                var area: F = 0;
                const list = if (f.kind == .field) L.fields.items else L.cities.items;
                for (list) |r| if (r.feature == fi) {
                    area += @abs(vec.signedArea(r.pts));
                };
                if (area < 0.005) {
                    std.debug.print("tile {s} feature {d} ({s}) area {d}\n", .{ def.id, fi, @tagName(f.kind), area });
                    return error.EmptyRegion;
                }
            }
            const got = L.classify(L.anchors[fi]);
            if (got != k) {
                std.debug.print("tile {s}: anchor of feature {d} ({s}) classifies as {d}\n", .{ def.id, fi, @tagName(f.kind), got });
                return error.AnchorOffFeature;
            }
        }
        // field polygons must not cover cities
        for (L.fields.items) |r| {
            const c = centroidInside(r.pts);
            try testing.expect(!L.isCity(c));
        }
    }
}

fn centroidInside(poly: []const V2) V2 {
    // a vertex-average nudged until inside: good enough for a sanity check
    var c = V2.init(0, 0);
    for (poly) |p| c = c.add(p);
    c = c.scale(1.0 / @as(F, @floatFromInt(poly.len)));
    if (vec.pointInPoly(c, poly)) return c;
    for (poly, 0..) |a, i| {
        const b = poly[(i + 1) % poly.len];
        const m = a.lerp(b, 0.5).add(b.sub(a).norm().perp().scale(0.004));
        if (vec.pointInPoly(m, poly)) return m;
    }
    return c;
}

/// Sorted positions (0..1 along the side, clockwise) of all region vertices
/// on side `s`, corners excluded.
fn borderSignature(a: std.mem.Allocator, L: *const layout.Layout, s: u2) ![]F {
    var us: std.ArrayList(F) = .empty;
    const add = struct {
        fn f(al: std.mem.Allocator, list: *std.ArrayList(F), side: u2, pts: []const V2) !void {
            for (pts) |p| {
                if (!vec.onBorder(p, 1e-9)) continue;
                const t = vec.perimParam(p);
                const sd: F = @floatFromInt(side);
                const u = t - sd;
                if (u <= 1e-6 or u >= 1 - 1e-6) continue; // other side or corner
                var dup = false;
                for (list.items) |x| if (@abs(x - u) < 1e-6) {
                    dup = true;
                };
                if (!dup) try list.append(al, u);
            }
        }
    }.f;
    for (L.fields.items) |r| try add(a, &us, s, r.pts);
    for (L.cities.items) |r| try add(a, &us, s, r.pts);
    for (L.ponds.items) |d| try add(a, &us, s, d.pts);
    for (L.lines.items) |l| {
        if (l.kind == .wall) continue;
        try add(a, &us, s, try layout.bandPolygon(a, l.pts, l.hw));
        try add(a, &us, s, l.pts);
    }
    std.mem.sort(F, us.items, {}, std.sort.asc(F));
    return us.items;
}

test "edge alignment: border vertices depend only on the edge kind (and mirror)" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var ref: [4]?[]F = .{ null, null, null, null };
    var ref_id: [4][]const u8 = undefined;
    for (registry.tiles) |*def| {
        var L = try layout.build(testing.allocator, def);
        defer L.deinit();
        for (0..4) |si| {
            const s: u2 = @intCast(si);
            const ek = @intFromEnum(def.edgeKind(@enumFromInt(s)));
            const sig = try borderSignature(a, &L, s);
            // mirror symmetry: a matching neighbour sees u -> 1-u
            for (sig) |u| {
                var found = false;
                for (sig) |w| if (@abs(w - (1 - u)) < 1e-6) {
                    found = true;
                };
                if (!found) {
                    std.debug.print("tile {s} side {d}: border vertex {d} has no mirror\n", .{ def.id, s, u });
                    return error.EdgeNotSymmetric;
                }
            }
            if (ref[ek]) |r| {
                var ok = r.len == sig.len;
                if (ok) for (r, sig) |x, y| {
                    if (@abs(x - y) > 1e-6) ok = false;
                };
                if (!ok) {
                    std.debug.print("edge kind {d}: {s} side {d} = {any}\n  vs {s} = {any}\n", .{ ek, def.id, s, sig, ref_id[ek], r });
                    return error.EdgeMismatch;
                }
            } else {
                ref[ek] = sig;
                ref_id[ek] = def.id;
            }
        }
    }
}

test "edge alignment: road/river ends are perpendicular stubs at the port centre" {
    for (registry.tiles) |*def| {
        var L = try layout.build(testing.allocator, def);
        defer L.deinit();
        for (L.lines.items) |l| {
            if (l.kind == .wall) continue;
            for ([_]usize{ 0, l.pts.len - 1 }) |i| {
                const p = l.pts[i];
                if (!vec.onBorder(p, 1e-9)) continue;
                const q = l.pts[if (i == 0) 1 else i - 1];
                const t = vec.perimParam(p);
                const side: u2 = @intCast(@as(u32, @intFromFloat(@floor(t))) % 4);
                try testing.expectApproxEqAbs(@as(F, 0.5), t - @floor(t), 1e-9);
                const d = q.sub(p).norm();
                const n = vec.sideInward(side);
                try testing.expectApproxEqAbs(@as(F, 1), d.dot(n), 1e-12);
            }
        }
    }
}

test "3D: border heights depend only on the edge kind; mesh is valid" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const R = 32;
    var ref: [4]?[R + 1]f32 = .{ null, null, null, null };
    for (registry.tiles) |*def| {
        var L = try layout.build(testing.allocator, def);
        defer L.deinit();
        const m = try mesh.build(a, &L, R);
        const nv = m.verts.items.len;
        try testing.expect(m.indices.items.len % 3 == 0);
        for (m.indices.items) |i| try testing.expect(i < nv);
        for (m.verts.items) |v| {
            const l = @sqrt(v.nrm[0] * v.nrm[0] + v.nrm[1] * v.nrm[1] + v.nrm[2] * v.nrm[2]);
            try testing.expectApproxEqAbs(@as(f32, 1), l, 1e-4);
            for (v.pos) |c| try testing.expect(std.math.isFinite(c));
            try testing.expect(v.pos[0] >= -1e-6 and v.pos[0] <= 1 + 1e-6 and v.pos[2] >= -1e-6 and v.pos[2] <= 1 + 1e-6);
        }
        // groups cover the index buffer exactly
        var covered: u32 = 0;
        for (m.groups.items) |g| {
            try testing.expectEqual(covered, g.start);
            covered += g.count;
        }
        try testing.expectEqual(@as(u32, @intCast(m.indices.items.len)), covered);
        // terrain triangles face up
        const tg = m.groups.items[0];
        var k: usize = tg.start;
        while (k < tg.start + tg.count) : (k += 3) {
            const p0 = m.verts.items[m.indices.items[k]].pos;
            const p1 = m.verts.items[m.indices.items[k + 1]].pos;
            const p2 = m.verts.items[m.indices.items[k + 2]].pos;
            const ny = (p1[2] - p0[2]) * (p2[0] - p0[0]) - (p1[0] - p0[0]) * (p2[2] - p0[2]);
            try testing.expect(ny > 0);
        }
        try testing.expectEqual(def.features.len, m.anchors.len);
        for (m.props.items) |p| try testing.expect(p.pos[0] > 0 and p.pos[0] < 1 and p.pos[2] > 0 and p.pos[2] < 1);

        // border heights along each side, clockwise
        for (0..4) |si| {
            var hs: [R + 1]f32 = undefined;
            for (0..R + 1) |q| {
                const u: F = @as(F, @floatFromInt(q)) / R;
                const p: V2 = switch (si) {
                    0 => .{ .x = u, .y = 0 },
                    1 => .{ .x = 1, .y = u },
                    2 => .{ .x = 1 - u, .y = 1 },
                    else => .{ .x = 0, .y = 1 - u },
                };
                const i: usize = @intFromFloat(@round(p.x * R));
                const j: usize = @intFromFloat(@round(p.y * R));
                hs[q] = m.verts.items[j * (R + 1) + i].pos[1];
            }
            for (0..R + 1) |q| try testing.expectApproxEqAbs(hs[q], hs[R - q], 1e-6);
            const ek = @intFromEnum(def.edgeKind(@enumFromInt(si)));
            if (ref[ek]) |r| {
                for (r, hs) |x, y| try testing.expectApproxEqAbs(x, y, 1e-6);
            } else ref[ek] = hs;
        }
    }
}

test "determinism: identical bytes on repeated encodes" {
    for (registry.tiles) |*def| {
        var a1 = std.heap.ArenaAllocator.init(testing.allocator);
        defer a1.deinit();
        var a2 = std.heap.ArenaAllocator.init(testing.allocator);
        defer a2.deinit();
        var L1 = try layout.build(testing.allocator, def);
        defer L1.deinit();
        var L2 = try layout.build(testing.allocator, def);
        defer L2.deinit();
        try testing.expectEqualSlices(u8, try buffer.encode2D(a1.allocator(), &L1), try buffer.encode2D(a2.allocator(), &L2));
        try testing.expectEqualSlices(u8, try buffer.encode3D(a1.allocator(), &L1, 16), try buffer.encode3D(a2.allocator(), &L2, 16));
    }
}

test "buffer round trip: sections parse and counts match" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const def = registry.byId("fx-cap-crossroads").?;
    var L = try layout.build(testing.allocator, def);
    defer L.deinit();
    const b2 = try buffer.encode2D(a, &L);
    const r2 = buffer.Reader{ .bytes = b2 };
    try testing.expectEqual(buffer.KIND_2D, r2.kind());
    try testing.expectEqual(@as(u32, @intCast(def.features.len)), r2.find(buffer.tag("FEAT")).?.count);
    const paths = r2.find(buffer.tag("PATH")).?;
    const pnts = r2.find(buffer.tag("PNTS")).?;
    try testing.expectEqual(pnts.count * 8, @as(u32, @intCast(pnts.data.len)));
    var total: u32 = 0;
    for (0..paths.count) |i| total += buffer.Reader.u32At(paths.data, i * 4 + 2);
    try testing.expectEqual(pnts.count, total);
    const b3 = try buffer.encode3D(a, &L, 8);
    const r3 = buffer.Reader{ .bytes = b3 };
    try testing.expect(r3.find(buffer.tag("VPOS")).?.count >= 81);
    try testing.expect(std.mem.readInt(u32, b3[8..12], .little) == b3.len);
}
