//! 2D region layout of a tile: partitions the unit square (x right, y down,
//! canonical orientation = rot 0) into feature regions derived from a TileDef.
//!
//! Construction (deterministic; the only "randomness" is a jitter seeded by
//! the tile id hash, and it is tapered to zero at the tile border so
//! neighbouring tiles always line up):
//!   1. Cities: polygons hugging their sides. Each run of non-city sides
//!      ("gap") is closed by a curve between the two tile corners; those
//!      curves are the city walls.
//!   2. Roads/rivers: centre-line splines port -> port (2 ports), or
//!      port -> junction (3+ dead ends, junction plaza), port -> cloister,
//!      port -> city gate, or port -> spring/lake.
//!   3. Fields: faces of the planar graph (tile border + walls + road/river
//!      centre lines, dangling dead ends pruned), each assigned to the field
//!      feature owning the most border ports of that face, then shrunk off
//!      the roads/rivers by their half widths (so fields + roads + cities form
//!      a partition, up to junction plazas).
//!   4. Cloister/garden: building footprints near the centre.
//!   5. Anchors (meeple spots) by a clearance search; pennants likewise.

const std = @import("std");
const tile = @import("../engine/tile.zig");
const vec = @import("vec.zig");
const V2 = vec.V2;
const F = vec.F;
const Allocator = std.mem.Allocator;

pub const NONE: u8 = 255;
/// Half widths (tile units). Identical on every tile so ports line up.
pub const ROAD_HW: F = 0.055;
pub const RIVER_HW: F = 0.075;
pub const PLAZA_R: F = 0.1;
pub const LAKE_R: F = 0.21;
pub const SPRING_R: F = 0.075;
pub const CLOISTER_HALF: F = 0.115;
pub const GARDEN_R: F = 0.085;
pub const SEGS: usize = 24;

pub const LineKind = enum(u8) { road, river, wall };

pub const Line = struct {
    feature: u8,
    kind: LineKind,
    hw: F,
    /// Render geometry (centre line, or wall line).
    pts: []V2,
    /// Geometry used for the planar graph (may extend through a city wall).
    gpts: []V2,
};

pub const Region = struct { feature: u8, pts: []V2 };

pub const Building = struct {
    feature: u8,
    kind: tile.FeatureKind, // cloister | garden
    center: V2,
    half: F,
    pts: []V2,
};

pub const Disc = struct { feature: u8, center: V2, r: F, pts: []V2 };

pub const Pennant = struct { feature: u8, p: V2 };

pub const Layout = struct {
    arena: std.heap.ArenaAllocator,
    def: *const tile.TileDef,
    seed: u64,
    owner: [12]u8 = @splat(NONE),
    cities: std.ArrayList(Region) = .empty,
    lines: std.ArrayList(Line) = .empty,
    fields: std.ArrayList(Region) = .empty,
    buildings: std.ArrayList(Building) = .empty,
    ponds: std.ArrayList(Disc) = .empty,
    /// Junction plazas; `feature` is the road used when classifying points.
    plazas: std.ArrayList(Disc) = .empty,
    pennants: std.ArrayList(Pennant) = .empty,
    anchors: []V2 = &.{},

    pub fn deinit(self: *Layout) void {
        self.arena.deinit();
    }

    pub fn kind(self: *const Layout, f: u8) tile.FeatureKind {
        return self.def.features[f].kind;
    }

    /// Which feature owns point p (canonical tile space). NONE when nothing does.
    pub fn classify(self: *const Layout, p: V2) u8 {
        for (self.buildings.items) |b| {
            if (vec.pointInPoly(p, b.pts)) return b.feature;
        }
        for (self.ponds.items) |d| {
            if (p.dist(d.center) < d.r) return d.feature;
        }
        // rivers before roads (bridges are drawn over rivers, but a river
        // point under a bridge is still water for terrain purposes)
        var best: u8 = NONE;
        var best_d: F = std.math.inf(F);
        for (self.lines.items) |l| {
            if (l.kind == .wall) continue;
            const d = vec.distPointPolyline(p, l.pts);
            if (d < l.hw and d - l.hw < best_d) {
                best_d = d - l.hw;
                best = l.feature;
            }
        }
        if (best != NONE) return best;
        for (self.plazas.items) |d| {
            if (p.dist(d.center) < d.r) return d.feature;
        }
        // On the tile border the port owner decides (point-in-polygon is
        // ambiguous exactly on a polygon edge), so seams classify alike.
        if (vec.onBorder(p, 1e-9)) {
            const t = vec.perimParam(p);
            const port: usize = @min(11, @as(usize, @intFromFloat(@floor(t * 3.0))));
            const o = self.owner[port];
            if (o != NONE and self.def.features[o].kind == .city) return o;
        }
        for (self.cities.items) |c| {
            if (vec.pointInPoly(p, c.pts)) return c.feature;
        }
        for (self.fields.items) |r| {
            if (vec.pointInPoly(p, r.pts)) return r.feature;
        }
        // Thin slivers (junction miters, numeric edge cases): nearest field.
        var nf: u8 = NONE;
        var nd: F = 0.03;
        for (self.fields.items) |r| {
            const d = vec.distPointRing(p, r.pts);
            if (d < nd) {
                nd = d;
                nf = r.feature;
            }
        }
        return nf;
    }

    /// Wall lines (city boundaries facing non-city ground).
    pub fn isCity(self: *const Layout, p: V2) bool {
        for (self.cities.items) |c| if (vec.pointInPoly(p, c.pts)) return true;
        return false;
    }
};

// ---------------------------------------------------------------------------

fn sideMask(ports: tile.PortMask) u4 {
    var m: u4 = 0;
    var s: u3 = 0;
    while (s < 4) : (s += 1) {
        const sh: u4 = @intCast(@as(u5, s) * 3);
        if ((ports >> sh) & 7 != 0) m |= @as(u4, 1) << @intCast(s);
    }
    return m;
}

fn hasSide(m: u4, s: usize) bool {
    return (m >> @intCast(s % 4)) & 1 != 0;
}

pub fn portPoint(p: u4) V2 {
    return vec.perimPoint((@as(F, @floatFromInt(p)) + 0.5) / 3.0);
}

fn portSide(p: u4) u2 {
    return @intCast(p / 3);
}

fn noise1(u: F, seed: u64) F {
    var r = vec.Rng.init(seed);
    const f1 = 1.0 + @floor(r.float() * 2.0);
    const f2 = 3.0 + @floor(r.float() * 3.0);
    const p1 = r.float();
    const p2 = r.float();
    const tau = 2.0 * std.math.pi;
    return 0.65 * @sin(tau * (f1 * u * 0.5 + p1)) + 0.35 * @sin(tau * (f2 * u * 0.5 + p2));
}

/// Displace interior points along the normal, tapered to zero at both ends.
fn jitter(pts: []V2, amp: F, seed: u64) void {
    if (pts.len < 3 or amp == 0) return;
    const orig_buf_len = pts.len;
    // compute normals from the undisplaced geometry
    var normals: [256]V2 = undefined;
    std.debug.assert(orig_buf_len <= normals.len);
    for (pts, 0..) |_, i| {
        const a = pts[if (i == 0) 0 else i - 1];
        const b = pts[@min(i + 1, pts.len - 1)];
        normals[i] = b.sub(a).norm().perp();
    }
    const total = vec.polylineLength(pts);
    if (total < 1e-9) return;
    var acc: F = 0;
    var prev = pts[0];
    for (pts, 0..) |*p, i| {
        acc += p.dist(prev);
        prev = p.*;
        if (i <= 1 or i + 2 >= pts.len) continue;
        const u = acc / total;
        const taper = vec.smoothstep(0, 0.22, u) * vec.smoothstep(0, 0.22, 1 - u);
        p.* = p.add(normals[i].scale(amp * taper * noise1(u, seed)));
    }
}

fn sampleCubic(a: Allocator, p0: V2, p1: V2, p2: V2, p3: V2, n: usize) ![]V2 {
    const out = try a.alloc(V2, n + 1);
    for (out, 0..) |*o, i| {
        const t: F = @as(F, @floatFromInt(i)) / @as(F, @floatFromInt(n));
        const u = 1 - t;
        o.* = p0.scale(u * u * u).add(p1.scale(3 * u * u * t)).add(p2.scale(3 * u * t * t)).add(p3.scale(t * t * t));
    }
    out[0] = p0;
    out[n] = p3;
    return out;
}

/// Gap curve from corner c0 clockwise across g non-city sides (1..3).
fn gapCurve(a: Allocator, c0: u2, g: u2, seed: u64) ![]V2 {
    const n = SEGS;
    const out = try a.alloc(V2, n + 1);
    const canon_c0: u2 = if (g == 1) 2 else 1;
    const r: u2 = c0 -% canon_c0;
    for (out, 0..) |*o, i| {
        const u: F = @as(F, @floatFromInt(i)) / @as(F, @floatFromInt(n));
        const s = @sin(std.math.pi * u);
        const q: V2 = switch (g) {
            // city on N only: lens from NE to NW
            3 => .{ .x = 1 - u, .y = 0.3 * std.math.pow(F, s, 1.3) },
            // city on N+W: diagonal NE -> SW bowed toward the city corner
            2 => V2.init(1 - u, u).sub(V2.init(1, 1).scale(0.055 * s)),
            // city on N+E+W: arch from SE to SW
            1 => .{ .x = 1 - u, .y = 1 - 0.36 * std.math.pow(F, s, 0.75) },
            0 => unreachable,
        };
        o.* = vec.rotQ(q, r);
    }
    out[0] = vec.cornerPoint(c0);
    out[n] = vec.cornerPoint(c0 +% g);
    jitter(out, 0.006, seed);
    return out;
}

fn dedupe(list: *std.ArrayList(V2), closed: bool) void {
    var w: usize = 0;
    for (list.items) |p| {
        if (w > 0 and list.items[w - 1].eql(p, 1e-9)) continue;
        list.items[w] = p;
        w += 1;
    }
    list.items.len = w;
    if (closed) while (list.items.len > 1 and list.items[0].eql(list.items[list.items.len - 1], 1e-9)) {
        list.items.len -= 1;
    };
}

/// Clean a closed polygon: drop near-duplicates and back-tracking spikes.
fn cleanRing(list: *std.ArrayList(V2)) void {
    var changed = true;
    var guard: usize = 0;
    while (changed and guard < 64) : (guard += 1) {
        changed = false;
        dedupe(list, true);
        const n = list.items.len;
        if (n < 3) return;
        var i: usize = 0;
        while (i < list.items.len and list.items.len >= 3) : (i += 1) {
            const m = list.items.len;
            const a = list.items[(i + m - 1) % m];
            const b = list.items[i];
            const c = list.items[(i + 1) % m];
            const d1 = b.sub(a);
            const d2 = c.sub(b);
            const l1 = d1.len();
            const l2 = d2.len();
            if (l1 < 1e-7 or l2 < 1e-7) continue;
            const cr = d1.cross(d2) / (l1 * l2);
            const dt = d1.dot(d2) / (l1 * l2);
            if (@abs(cr) < 1e-6 and dt < 0) {
                _ = list.orderedRemove(i);
                changed = true;
                break;
            }
        }
    }
}

fn circlePoly(a: Allocator, c: V2, r: F, n: usize) ![]V2 {
    const out = try a.alloc(V2, n);
    for (out, 0..) |*o, i| {
        const ang = 2.0 * std.math.pi * @as(F, @floatFromInt(i)) / @as(F, @floatFromInt(n));
        o.* = .{ .x = c.x + r * @cos(ang), .y = c.y + r * @sin(ang) };
    }
    return out;
}

fn squarePoly(a: Allocator, c: V2, h: F) ![]V2 {
    const out = try a.alloc(V2, 4);
    out[0] = .{ .x = c.x - h, .y = c.y - h };
    out[1] = .{ .x = c.x + h, .y = c.y - h };
    out[2] = .{ .x = c.x + h, .y = c.y + h };
    out[3] = .{ .x = c.x - h, .y = c.y + h };
    return out;
}

/// Road from port point p0 (inward normal n0) to free point e.
/// Straight stub length at ports: the first/last segment of every road/river is
/// exactly perpendicular to the tile edge, so bands line up across tiles.
pub const STUB: F = 0.04;

fn withStubs(a: Allocator, head: ?V2, mid: []const V2, tail: ?V2) ![]V2 {
    var list: std.ArrayList(V2) = .empty;
    if (head) |h| try list.append(a, h);
    try list.appendSlice(a, mid);
    if (tail) |t| try list.append(a, t);
    return list.items;
}

/// Road from port point p0 (inward normal n0) to free point e.
fn curveToPoint(a: Allocator, p0: V2, n0: V2, e: V2) ![]V2 {
    const q0 = p0.add(n0.scale(STUB));
    const d = q0.dist(e);
    const c1 = q0.add(n0.scale(d * 0.45));
    const c2 = e.add(c1.sub(e).scale(0.35));
    return withStubs(a, p0, try sampleCubic(a, q0, c1, c2, e, SEGS - 1), null);
}

fn curveBetween(a: Allocator, p0: V2, n0: V2, p1: V2, n1: V2) ![]V2 {
    const q0 = p0.add(n0.scale(STUB));
    const q1 = p1.add(n1.scale(STUB));
    const k = 0.39 * q0.dist(q1);
    return withStubs(a, p0, try sampleCubic(a, q0, q0.add(n0.scale(k)), q1.add(n1.scale(k)), q1, SEGS - 2), p1);
}

/// First crossing of polyline `pts` (walked from its start) with any wall.
fn firstWallHit(walls: []const Line, pts: []const V2) ?struct { seg: usize, t: F } {
    var i: usize = 0;
    while (i + 1 < pts.len) : (i += 1) {
        var best: ?F = null;
        for (walls) |w| {
            var j: usize = 0;
            while (j + 1 < w.pts.len) : (j += 1) {
                if (vec.segIntersect(pts[i], pts[i + 1], w.pts[j], w.pts[j + 1])) |hit| {
                    if (hit.t > 1e-6 and (best == null or hit.t < best.?)) best = hit.t;
                }
            }
        }
        if (best) |t| return .{ .seg = i, .t = t };
    }
    return null;
}

fn truncate(a: Allocator, pts: []const V2, seg: usize, t: F, back: F) ![]V2 {
    var list: std.ArrayList(V2) = .empty;
    var i: usize = 0;
    while (i <= seg) : (i += 1) try list.append(a, pts[i]);
    try list.append(a, pts[seg].lerp(pts[seg + 1], t));
    // walk back `back` units of arc length
    var remaining = back;
    while (remaining > 0 and list.items.len >= 2) {
        const n = list.items.len;
        const l = list.items[n - 1].dist(list.items[n - 2]);
        if (l > remaining) {
            list.items[n - 1] = list.items[n - 1].lerp(list.items[n - 2], remaining / l);
            break;
        }
        remaining -= l;
        list.items.len -= 1;
    }
    return list.items;
}

// ---------------------------------------------------------------------------
// Planar graph

const Tag = struct { kind: enum(u8) { perim, wall, road, river }, feature: u8, hw: F };

const GLine = struct { pts: []const V2, closed: bool, tag: Tag };

const Insert = struct { seg: usize, t: F, p: V2 };

const Edge = struct { a: u32, b: u32, tag: Tag, alive: bool = true };

const Face = struct { pts: []V2, tags: []Tag };

fn buildFaces(a: Allocator, glines: []const GLine) ![]Face {
    // 1. Split lines at mutual intersections.
    const inserts = try a.alloc(std.ArrayList(Insert), glines.len);
    for (inserts) |*l| l.* = .empty;
    for (glines, 0..) |la, ia| {
        const na = if (la.closed) la.pts.len else la.pts.len - 1;
        for (glines[ia + 1 ..], ia + 1..) |lb, ib| {
            if (la.tag.kind == .perim and lb.tag.kind == .perim) continue;
            const nb = if (lb.closed) lb.pts.len else lb.pts.len - 1;
            var i: usize = 0;
            while (i < na) : (i += 1) {
                const a0 = la.pts[i];
                const a1 = la.pts[(i + 1) % la.pts.len];
                var j: usize = 0;
                while (j < nb) : (j += 1) {
                    const b0 = lb.pts[j];
                    const b1 = lb.pts[(j + 1) % lb.pts.len];
                    if (@max(a0.x, a1.x) < @min(b0.x, b1.x) - 1e-9 or @max(b0.x, b1.x) < @min(a0.x, a1.x) - 1e-9 or
                        @max(a0.y, a1.y) < @min(b0.y, b1.y) - 1e-9 or @max(b0.y, b1.y) < @min(a0.y, a1.y) - 1e-9) continue;
                    const hit = vec.segIntersect(a0, a1, b0, b1) orelse continue;
                    const p = a0.lerp(a1, hit.t);
                    const e = 1e-7;
                    if (hit.t > e and hit.t < 1 - e) try inserts[ia].append(a, .{ .seg = i, .t = hit.t, .p = p });
                    if (hit.u > e and hit.u < 1 - e) try inserts[ib].append(a, .{ .seg = j, .t = hit.u, .p = p });
                }
            }
        }
    }

    // 2. Vertices + edges.
    var verts: std.ArrayList(V2) = .empty;
    var edges: std.ArrayList(Edge) = .empty;
    const vid = struct {
        fn get(al: Allocator, vs: *std.ArrayList(V2), p: V2) !u32 {
            for (vs.items, 0..) |q, k| if (q.eql(p, 1e-7)) return @intCast(k);
            try vs.append(al, p);
            return @intCast(vs.items.len - 1);
        }
    };
    for (glines, 0..) |l, li| {
        const ins = inserts[li].items;
        std.mem.sort(Insert, ins, {}, struct {
            fn lt(_: void, x: Insert, y: Insert) bool {
                return if (x.seg != y.seg) x.seg < y.seg else x.t < y.t;
            }
        }.lt);
        var seq: std.ArrayList(u32) = .empty;
        const nseg = if (l.closed) l.pts.len else l.pts.len - 1;
        var k: usize = 0;
        var s: usize = 0;
        while (s < nseg) : (s += 1) {
            try seq.append(a, try vid.get(a, &verts, l.pts[s]));
            while (k < ins.len and ins[k].seg == s) : (k += 1) try seq.append(a, try vid.get(a, &verts, ins[k].p));
        }
        try seq.append(a, try vid.get(a, &verts, l.pts[if (l.closed) 0 else l.pts.len - 1]));
        var q: usize = 0;
        while (q + 1 < seq.items.len) : (q += 1) {
            const va = seq.items[q];
            const vb = seq.items[q + 1];
            if (va == vb) continue;
            var dup = false;
            for (edges.items) |e| {
                if ((e.a == va and e.b == vb) or (e.a == vb and e.b == va)) {
                    dup = true;
                    break;
                }
            }
            if (!dup) try edges.append(a, .{ .a = va, .b = vb, .tag = l.tag });
        }
    }

    // 3. Prune dangling edges.
    const nv = verts.items.len;
    const deg = try a.alloc(u32, nv);
    @memset(deg, 0);
    for (edges.items) |e| {
        deg[e.a] += 1;
        deg[e.b] += 1;
    }
    var changed = true;
    while (changed) {
        changed = false;
        for (edges.items) |*e| {
            if (!e.alive) continue;
            if (deg[e.a] <= 1 or deg[e.b] <= 1) {
                e.alive = false;
                deg[e.a] -= 1;
                deg[e.b] -= 1;
                changed = true;
            }
        }
    }

    // 4. Angle-sorted adjacency.
    const Adj = struct { to: u32, edge: u32, ang: F };
    const adj = try a.alloc(std.ArrayList(Adj), nv);
    for (adj) |*l| l.* = .empty;
    for (edges.items, 0..) |e, ei| {
        if (!e.alive) continue;
        const pa = verts.items[e.a];
        const pb = verts.items[e.b];
        try adj[e.a].append(a, .{ .to = e.b, .edge = @intCast(ei), .ang = std.math.atan2(pb.y - pa.y, pb.x - pa.x) });
        try adj[e.b].append(a, .{ .to = e.a, .edge = @intCast(ei), .ang = std.math.atan2(pa.y - pb.y, pa.x - pb.x) });
    }
    for (adj) |l| std.mem.sort(Adj, l.items, {}, struct {
        fn lt(_: void, x: Adj, y: Adj) bool {
            return x.ang < y.ang;
        }
    }.lt);

    // 5. Trace faces (half-edge (edge, dir)); interior faces have positive area.
    const visited = try a.alloc(bool, edges.items.len * 2);
    @memset(visited, false);
    var faces: std.ArrayList(Face) = .empty;
    for (edges.items, 0..) |e0, ei0| {
        if (!e0.alive) continue;
        var dir0: u32 = 0;
        while (dir0 < 2) : (dir0 += 1) {
            if (visited[ei0 * 2 + dir0]) continue;
            var pts: std.ArrayList(V2) = .empty;
            var tags: std.ArrayList(Tag) = .empty;
            var ei: u32 = @intCast(ei0);
            var dir = dir0;
            var guard: usize = 0;
            while (!visited[ei * 2 + dir] and guard < 100000) : (guard += 1) {
                visited[ei * 2 + dir] = true;
                const e = edges.items[ei];
                const u = if (dir == 0) e.a else e.b;
                const v = if (dir == 0) e.b else e.a;
                try pts.append(a, verts.items[u]);
                try tags.append(a, e.tag);
                const l = adj[v].items;
                var idx: usize = 0;
                for (l, 0..) |x, k| if (x.edge == ei) {
                    idx = k;
                    break;
                };
                const nx = l[(idx + l.len - 1) % l.len];
                ei = nx.edge;
                dir = if (edges.items[nx.edge].a == v) 0 else 1;
            }
            if (vec.signedArea(pts.items) > 1e-9) try faces.append(a, .{ .pts = pts.items, .tags = tags.items });
        }
    }
    return faces.items;
}

/// A point strictly inside a polygon (positive orientation).
fn interiorPoint(poly: []const V2) V2 {
    var best = poly[0];
    var best_d: F = -1;
    for (poly, 0..) |a, i| {
        const b = poly[(i + 1) % poly.len];
        const l = b.sub(a).len();
        if (l < 1e-6) continue;
        const m = a.lerp(b, 0.5);
        const n = b.sub(a).norm().perp();
        var eps: F = 0.002;
        while (eps < 0.2) : (eps *= 2) {
            const q = m.add(n.scale(eps));
            if (vec.pointInPoly(q, poly)) {
                const d = vec.distPointRing(q, poly);
                if (d > best_d) {
                    best_d = d;
                    best = q;
                }
            }
        }
    }
    return best;
}

/// Inset a positive-area face by per-edge distances (roads/rivers), miter joins.
fn offsetFace(a: Allocator, f: Face) ![]V2 {
    const n = f.pts.len;
    var out: std.ArrayList(V2) = .empty;
    var i: usize = 0;
    while (i < n) : (i += 1) {
        const ip = (i + n - 1) % n;
        const v = f.pts[i];
        const dp = f.tags[ip].hw;
        const dn = f.tags[i].hw;
        if (dp == 0 and dn == 0) {
            try out.append(a, v);
            continue;
        }
        const dirp = v.sub(f.pts[ip]).norm();
        const dirn = f.pts[(i + 1) % n].sub(v).norm();
        const np = dirp.perp();
        const nn = dirn.perp();
        const A = v.add(np.scale(dp));
        const B = v.add(nn.scale(dn));
        const fallback = v.add(np.scale(dp).add(nn.scale(dn)).scale(0.5));
        var x = vec.lineIntersect(A, dirp, B, dirn) orelse fallback;
        if (x.dist(v) > 3.0 * @max(dp, dn)) x = fallback;
        try out.append(a, x);
    }
    cleanRing(&out);
    return out.items;
}

// ---------------------------------------------------------------------------

pub fn build(gpa: Allocator, def: *const tile.TileDef) !Layout {
    var L = Layout{ .arena = std.heap.ArenaAllocator.init(gpa), .def = def, .seed = vec.hashStr(def.id) };
    errdefer L.arena.deinit();
    const a = L.arena.allocator();
    const feats = def.features;
    const nf: u8 = @intCast(feats.len);

    for (feats, 0..) |f, fi| {
        var p: u4 = 0;
        while (p < 12) : (p += 1) {
            if (f.ports & (@as(tile.PortMask, 1) << p) != 0 and L.owner[p] == NONE) L.owner[p] = @intCast(fi);
        }
    }

    // 1. Cities + walls ------------------------------------------------------
    for (feats, 0..) |f, fi| {
        if (f.kind != .city) continue;
        const m = sideMask(f.ports);
        var poly: std.ArrayList(V2) = .empty;
        if (m == 0xF) {
            for (0..4) |c| try poly.append(a, vec.cornerPoint(@intCast(c)));
        } else if (m != 0) {
            var s0: usize = 0;
            while (!(hasSide(m, s0) and !hasSide(m, s0 + 3))) s0 += 1;
            var k: usize = 0;
            while (k < 4) {
                const s = (s0 + k) % 4;
                if (hasSide(m, s)) {
                    try poly.append(a, vec.cornerPoint(@intCast(s)));
                    k += 1;
                } else {
                    var g: usize = 0;
                    while (g < 4 and !hasSide(m, s + g)) g += 1;
                    const curve = try gapCurve(a, @intCast(s), @intCast(g), vec.mix(L.seed, fi * 7 + s));
                    try poly.appendSlice(a, curve);
                    try L.lines.append(a, .{ .feature = @intCast(fi), .kind = .wall, .hw = 0, .pts = curve, .gpts = curve });
                    k += g;
                }
            }
            dedupe(&poly, true);
        } else continue;
        try L.cities.append(a, .{ .feature = @intCast(fi), .pts = poly.items });
    }
    const n_walls = L.lines.items.len;

    // 2. Through roads/rivers (2 ports) --------------------------------------
    var dead_road: std.ArrayList(DeadEnd) = .empty;
    var dead_river: std.ArrayList(DeadEnd) = .empty;
    var multi: std.ArrayList(u8) = .empty;
    for (feats, 0..) |f, fi| {
        if (f.kind != .road and f.kind != .river) continue;
        const cnt = @popCount(f.ports);
        const lk: LineKind = if (f.kind == .road) .road else .river;
        const hw = if (f.kind == .road) ROAD_HW else RIVER_HW;
        if (cnt == 2) {
            var ps: [2]u4 = undefined;
            var n: usize = 0;
            var p: u4 = 0;
            while (p < 12) : (p += 1) if (f.ports & (@as(tile.PortMask, 1) << p) != 0) {
                ps[n] = p;
                n += 1;
            };
            const pts = try curveBetween(a, portPoint(ps[0]), vec.sideInward(portSide(ps[0])), portPoint(ps[1]), vec.sideInward(portSide(ps[1])));
            jitter(pts, if (lk == .river) 0.012 else 0.009, vec.mix(L.seed, 1000 + fi));
            try L.lines.append(a, .{ .feature = @intCast(fi), .kind = lk, .hw = hw, .pts = pts, .gpts = pts });
        } else if (cnt == 1) {
            var p: u4 = 0;
            while (f.ports & (@as(tile.PortMask, 1) << p) == 0) p += 1;
            if (f.kind == .road) try dead_road.append(a, .{ .f = @intCast(fi), .p = p }) else try dead_river.append(a, .{ .f = @intCast(fi), .p = p });
        } else if (cnt >= 3) {
            try multi.append(a, @intCast(fi));
        }
    }

    // 3. Cloister placement (avoid water, cities, through roads) -------------
    for (feats, 0..) |f, fi| {
        if (f.kind != .cloister) continue;
        var best = V2.init(0.5, 0.5);
        var best_s: F = -std.math.inf(F);
        var gy: usize = 0;
        while (gy <= 20) : (gy += 1) {
            var gx: usize = 0;
            while (gx <= 20) : (gx += 1) {
                const p = V2.init(0.2 + 0.03 * @as(F, @floatFromInt(gx)), 0.2 + 0.03 * @as(F, @floatFromInt(gy)));
                var clear: F = 1;
                for (L.lines.items) |l| {
                    const d = vec.distPointPolyline(p, l.pts) - l.hw;
                    clear = @min(clear, d);
                }
                if (L.isCity(p)) clear = -1;
                const s = @min(clear, CLOISTER_HALF * 1.6 + 0.03) - 0.5 * p.dist(V2.init(0.5, 0.5));
                if (s > best_s + 1e-12) {
                    best_s = s;
                    best = p;
                }
            }
        }
        try L.buildings.append(a, .{ .feature = @intCast(fi), .kind = .cloister, .center = best, .half = CLOISTER_HALF, .pts = try squarePoly(a, best, CLOISTER_HALF) });
    }

    // 4. Dead ends: junctions, cloister paths, city gates, springs ---------
    const walls = L.lines.items[0..n_walls];
    const center = V2.init(0.5, 0.5);
    var junction = center;
    if (L.isCity(junction)) {
        var mean = V2.init(0, 0);
        for (dead_road.items) |d| mean = mean.add(portPoint(d.p));
        if (dead_road.items.len > 0) mean = mean.scale(1.0 / @as(F, @floatFromInt(dead_road.items.len)));
        var t: F = 0;
        while (t < 1 and L.isCity(junction)) : (t += 0.05) junction = center.lerp(mean, t);
    }
    for ([_]bool{ false, true }) |is_river| {
        const list = if (is_river) dead_river.items else dead_road.items;
        const hw = if (is_river) RIVER_HW else ROAD_HW;
        const lk: LineKind = if (is_river) .river else .road;
        for (list) |d| {
            const p0 = portPoint(d.p);
            const n0 = vec.sideInward(portSide(d.p));
            const s: u4 = portSide(d.p);
            var target = center;
            var to_cloister = false;
            if (list.len >= 2) {
                target = junction;
            } else if (!is_river) {
                for (L.buildings.items) |b| if (b.kind == .cloister) {
                    target = b.center;
                    to_cloister = true;
                };
            }
            var pts = try curveToPoint(a, p0, n0, target);
            jitter(pts, 0.006, vec.mix(L.seed, 2000 + @as(u64, d.f)));
            var gpts = pts;
            if (list.len == 1 and !to_cloister) {
                if (firstWallHit(walls, pts)) |hit| {
                    const lo = L.owner[s * 3];
                    const hi = L.owner[s * 3 + 2];
                    if (lo != hi) {
                        // splits two fields: run into the city (gate)
                        pts = try truncate(a, pts, hit.seg, hit.t, 0);
                    } else {
                        pts = try truncate(a, pts, hit.seg, hit.t, 0.06);
                        gpts = pts;
                    }
                }
            }
            try L.lines.append(a, .{ .feature = d.f, .kind = lk, .hw = hw, .pts = pts, .gpts = gpts });
            if (list.len == 1 and is_river) {
                const r: F = switch (def.special) {
                    .lake => LAKE_R,
                    .spring => SPRING_R,
                    else => SPRING_R,
                };
                const e = pts[pts.len - 1];
                try L.ponds.append(a, .{ .feature = d.f, .center = e, .r = r, .pts = try circlePoly(a, e, r, 32) });
            }
        }
        if (list.len >= 2) {
            if (is_river) {
                try L.ponds.append(a, .{ .feature = list[0].f, .center = junction, .r = LAKE_R, .pts = try circlePoly(a, junction, LAKE_R, 32) });
            } else {
                try L.plazas.append(a, .{ .feature = list[0].f, .center = junction, .r = PLAZA_R, .pts = try circlePoly(a, junction, PLAZA_R, 20) });
            }
        }
    }
    for (multi.items) |fi| {
        const f = feats[fi];
        const lk: LineKind = if (f.kind == .road) .road else .river;
        var p: u4 = 0;
        while (p < 12) : (p += 1) if (f.ports & (@as(tile.PortMask, 1) << p) != 0) {
            const pts = try curveToPoint(a, portPoint(p), vec.sideInward(portSide(p)), junction);
            try L.lines.append(a, .{ .feature = fi, .kind = lk, .hw = if (lk == .road) ROAD_HW else RIVER_HW, .pts = pts, .gpts = pts });
        };
        try L.plazas.append(a, .{ .feature = fi, .center = junction, .r = PLAZA_R, .pts = try circlePoly(a, junction, PLAZA_R, 20) });
    }

    // 5. Planar graph -> field faces ------------------------------------------
    var glines: std.ArrayList(GLine) = .empty;
    {
        var ts: std.ArrayList(F) = .empty;
        for (0..12) |k| try ts.append(a, @as(F, @floatFromInt(k)) / 3.0);
        for (L.lines.items) |l| {
            if (l.kind == .wall) continue;
            const e0 = l.gpts[0];
            if (vec.onBorder(e0, 1e-9)) try ts.append(a, vec.perimParam(e0));
            const e1 = l.gpts[l.gpts.len - 1];
            if (vec.onBorder(e1, 1e-9)) try ts.append(a, vec.perimParam(e1));
        }
        std.mem.sort(F, ts.items, {}, std.sort.asc(F));
        var per: std.ArrayList(V2) = .empty;
        for (ts.items) |t| try per.append(a, vec.perimPoint(t));
        dedupe(&per, true);
        try glines.append(a, .{ .pts = per.items, .closed = true, .tag = .{ .kind = .perim, .feature = NONE, .hw = 0 } });
    }
    for (L.lines.items) |l| {
        try glines.append(a, .{ .pts = l.gpts, .closed = false, .tag = .{
            .kind = switch (l.kind) {
                .wall => .wall,
                .road => .road,
                .river => .river,
            },
            .feature = l.feature,
            .hw = l.hw,
        } });
    }
    const faces = try buildFaces(a, glines.items);
    const face_count = try a.alloc(u32, nf);
    @memset(face_count, 0);
    var pending: std.ArrayList(Face) = .empty;
    for (faces) |face| {
        const ip = interiorPoint(face.pts);
        if (L.isCity(ip)) continue;
        var votes: [256]F = @splat(0);
        for (face.pts, 0..) |pa, k| {
            if (face.tags[k].kind != .perim) continue;
            const pb = face.pts[(k + 1) % face.pts.len];
            const m = pa.lerp(pb, 0.5);
            const t = vec.perimParam(m);
            const port: u4 = @intCast(@min(11, @as(u32, @intFromFloat(@floor(t * 3.0)))));
            var o = L.owner[port];
            if (o == NONE or feats[o].kind != .field) {
                const side: u4 = port / 3;
                const u = t - @as(F, @floatFromInt(side));
                const q: u4 = if (u < 0.5) side * 3 else side * 3 + 2;
                o = L.owner[q];
            }
            if (o != NONE and feats[o].kind == .field) votes[o] += pa.dist(pb);
        }
        var bf: u8 = NONE;
        var bv: F = 0;
        for (votes[0..nf], 0..) |v, k| if (v > bv) {
            bv = v;
            bf = @intCast(k);
        };
        if (bf == NONE) {
            try pending.append(a, face);
            continue;
        }
        face_count[bf] += 1;
        try L.fields.append(a, .{ .feature = bf, .pts = try offsetFace(a, face) });
    }
    for (pending.items) |face| {
        var bf: u8 = NONE;
        for (feats, 0..) |f, k| if (f.kind == .field and face_count[k] == 0) {
            bf = @intCast(k);
            break;
        };
        if (bf == NONE) continue;
        face_count[bf] += 1;
        try L.fields.append(a, .{ .feature = bf, .pts = try offsetFace(a, face) });
    }

    // 6. Gardens: the roomiest field spot -------------------------------------
    for (feats, 0..) |f, fi| {
        if (f.kind != .garden) continue;
        const spot = searchSpot(&L, struct {
            fn ok(l: *const Layout, k: u8) bool {
                return k != NONE and l.kind(k) == .field;
            }
        }.ok, V2.init(0.5, 0.5), 0.4, null);
        try L.buildings.append(a, .{ .feature = @intCast(fi), .kind = .garden, .center = spot, .half = GARDEN_R, .pts = try circlePoly(a, spot, GARDEN_R, 16) });
    }

    // 7. Anchors + pennants ---------------------------------------------------
    L.anchors = try a.alloc(V2, nf);
    for (feats, 0..) |f, fi| {
        const k: u8 = @intCast(fi);
        L.anchors[fi] = switch (f.kind) {
            .cloister, .garden => blk: {
                for (L.buildings.items) |b| if (b.feature == k) break :blk b.center;
                break :blk center;
            },
            .road, .river => blk: {
                for (L.lines.items) |l| if (l.feature == k and l.kind != .wall) {
                    const fr = [_]F{ 0.5, 0.4, 0.6, 0.3, 0.7, 0.25, 0.75 };
                    for (fr) |x| {
                        const p = vec.polylineAt(l.pts, x).p;
                        if (L.classify(p) != k) continue;
                        var clear = true;
                        for (L.lines.items) |o| if (o.feature != k and o.kind != .wall and vec.distPointPolyline(p, o.pts) < o.hw + 0.06) {
                            clear = false;
                        };
                        if (clear) break :blk p;
                    }
                    break :blk vec.polylineAt(l.pts, 0.5).p;
                };
                for (L.ponds.items) |d| if (d.feature == k) break :blk d.center;
                break :blk center;
            },
            .city, .field => searchSpot(&L, null, regionCentroid(&L, k), 0.12, k),
        };
    }
    for (feats, 0..) |f, fi| {
        if (f.kind != .city or f.pennants == 0) continue;
        var placed: usize = 0;
        while (placed < f.pennants) : (placed += 1) {
            const p = pennantSpot(&L, @intCast(fi));
            try L.pennants.append(a, .{ .feature = @intCast(fi), .p = p });
        }
    }
    return L;
}

fn regionCentroid(L: *const Layout, f: u8) V2 {
    var s = V2.init(0, 0);
    var n: F = 0;
    const G = 24;
    for (0..G) |j| for (0..G) |i| {
        const p = V2.init((@as(F, @floatFromInt(i)) + 0.5) / G, (@as(F, @floatFromInt(j)) + 0.5) / G);
        if (L.classify(p) == f) {
            s = s.add(p);
            n += 1;
        }
    };
    return if (n > 0) s.scale(1.0 / n) else V2.init(0.5, 0.5);
}

const GRID = 40;
const DeadEnd = struct { f: u8, p: u4 };

/// Clearance-maximising spot inside the cells accepted by `pred` (or equal to
/// `feature`), biased toward `bias_to` with weight `w`.
fn searchSpot(L: *const Layout, pred: ?*const fn (*const Layout, u8) bool, bias_to: V2, w: F, feature: ?u8) V2 {
    var cls: [GRID * GRID]u8 = undefined;
    for (0..GRID) |j| for (0..GRID) |i| {
        cls[j * GRID + i] = L.classify(cellPt(i, j));
    };
    const inSet = struct {
        fn f(l: *const Layout, c: u8, p: ?*const fn (*const Layout, u8) bool, ft: ?u8) bool {
            if (ft) |x| return c == x;
            return p.?(l, c);
        }
    }.f;
    var best = bias_to;
    var best_s: F = -std.math.inf(F);
    const R = 12;
    for (0..GRID) |j| for (0..GRID) |i| {
        if (!inSet(L, cls[j * GRID + i], pred, feature)) continue;
        const p = cellPt(i, j);
        var d = @min(@min(p.x, p.y), @min(1 - p.x, 1 - p.y));
        const j0 = if (j >= R) j - R else 0;
        const ib = if (i >= R) i - R else 0;
        var jj = j0;
        while (jj < @min(GRID, j + R + 1)) : (jj += 1) {
            var ii = ib;
            while (ii < @min(GRID, i + R + 1)) : (ii += 1) {
                if (inSet(L, cls[jj * GRID + ii], pred, feature)) continue;
                d = @min(d, p.dist(cellPt(ii, jj)) - 0.5 / @as(F, GRID));
            }
        }
        const s = d - w * p.dist(bias_to);
        if (s > best_s + 1e-12) {
            best_s = s;
            best = p;
        }
    };
    return best;
}

fn pennantSpot(L: *const Layout, f: u8) V2 {
    const anchor = L.anchors[f];
    var best = anchor.add(V2.init(0.09, -0.07));
    var best_s: F = -std.math.inf(F);
    for (0..GRID) |j| for (0..GRID) |i| {
        const p = cellPt(i, j);
        if (L.classify(p) != f) continue;
        var near = p.dist(anchor);
        for (L.pennants.items) |q| near = @min(near, p.dist(q.p));
        if (near < 0.14) continue;
        var clear = @min(@min(p.x, p.y), @min(1 - p.x, 1 - p.y));
        for (L.lines.items) |l| if (l.kind == .wall) {
            clear = @min(clear, vec.distPointPolyline(p, l.pts));
        };
        const s = @min(clear, 0.12) - 0.3 * @abs(near - 0.2);
        if (s > best_s + 1e-12) {
            best_s = s;
            best = p;
        }
    };
    return best;
}

fn cellPt(i: usize, j: usize) V2 {
    return V2.init((@as(F, @floatFromInt(i)) + 0.5) / GRID, (@as(F, @floatFromInt(j)) + 0.5) / GRID);
}

/// Road/river band polygon (left offset + reversed right offset).
pub fn bandPolygon(a: Allocator, pts: []const V2, hw: F) ![]V2 {
    const n = pts.len;
    const out = try a.alloc(V2, n * 2);
    for (pts, 0..) |p, i| {
        const d0 = if (i > 0) p.sub(pts[i - 1]).norm() else pts[1].sub(p).norm();
        const d1 = if (i + 1 < n) pts[i + 1].sub(p).norm() else d0;
        var nrm = d0.add(d1).norm().perp();
        if (nrm.len() < 0.5) nrm = d0.perp();
        const c = @max(0.5, nrm.dot(d0.perp()));
        out[i] = p.add(nrm.scale(hw / c));
        out[2 * n - 1 - i] = p.sub(nrm.scale(hw / c));
    }
    return out;
}
