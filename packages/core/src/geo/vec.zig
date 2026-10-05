//! Small 2D vector + polyline helpers for geo. All internal math is f64;
//! buffers are emitted as f32.

const std = @import("std");

pub const F = f64;

pub const V2 = struct {
    x: F,
    y: F,

    pub fn init(x: F, y: F) V2 {
        return .{ .x = x, .y = y };
    }
    pub fn add(a: V2, b: V2) V2 {
        return .{ .x = a.x + b.x, .y = a.y + b.y };
    }
    pub fn sub(a: V2, b: V2) V2 {
        return .{ .x = a.x - b.x, .y = a.y - b.y };
    }
    pub fn scale(a: V2, s: F) V2 {
        return .{ .x = a.x * s, .y = a.y * s };
    }
    pub fn dot(a: V2, b: V2) F {
        return a.x * b.x + a.y * b.y;
    }
    pub fn cross(a: V2, b: V2) F {
        return a.x * b.y - a.y * b.x;
    }
    pub fn len(a: V2) F {
        return @sqrt(a.x * a.x + a.y * a.y);
    }
    pub fn dist(a: V2, b: V2) F {
        return a.sub(b).len();
    }
    pub fn norm(a: V2) V2 {
        const l = a.len();
        if (l < 1e-12) return .{ .x = 0, .y = 0 };
        return a.scale(1.0 / l);
    }
    /// Left normal in math orientation (rotate +90deg): (-y, x).
    pub fn perp(a: V2) V2 {
        return .{ .x = -a.y, .y = a.x };
    }
    pub fn lerp(a: V2, b: V2, t: F) V2 {
        return .{ .x = a.x + (b.x - a.x) * t, .y = a.y + (b.y - a.y) * t };
    }
    pub fn eql(a: V2, b: V2, eps: F) bool {
        return @abs(a.x - b.x) <= eps and @abs(a.y - b.y) <= eps;
    }
};

pub fn smoothstep(e0: F, e1: F, x: F) F {
    const t = std.math.clamp((x - e0) / (e1 - e0), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}

/// Rotate a point of the unit tile clockwise (screen coords, y down) by `r`
/// quarter turns about (0.5, 0.5). N edge -> E edge for r = 1.
pub fn rotQ(p: V2, r: u2) V2 {
    var q = p;
    var i: u2 = 0;
    while (i < r) : (i += 1) {
        const t = q;
        q = .{ .x = 1.0 - t.y, .y = t.x };
    }
    return q;
}

/// Point on the tile perimeter, t in [0,4): clockwise from the NW corner.
pub fn perimPoint(t_in: F) V2 {
    var t = @mod(t_in, 4.0);
    if (t < 0) t += 4.0;
    if (t <= 1.0) return .{ .x = t, .y = 0 };
    if (t <= 2.0) return .{ .x = 1, .y = t - 1.0 };
    if (t <= 3.0) return .{ .x = 3.0 - t, .y = 1 };
    return .{ .x = 0, .y = 4.0 - t };
}

/// Inverse of perimPoint for a point on (or very near) the border.
pub fn perimParam(p: V2) F {
    const e = 1e-7;
    if (p.y <= e and p.x < 1.0 - e) return std.math.clamp(p.x, 0, 1);
    if (p.x >= 1.0 - e and p.y < 1.0 - e) return 1.0 + std.math.clamp(p.y, 0, 1);
    if (p.y >= 1.0 - e and p.x > e) return 2.0 + (1.0 - std.math.clamp(p.x, 0, 1));
    return 3.0 + (1.0 - std.math.clamp(p.y, 0, 1));
}

pub fn onBorder(p: V2, eps: F) bool {
    return p.x <= eps or p.y <= eps or p.x >= 1.0 - eps or p.y >= 1.0 - eps;
}

/// Inward unit normal of side s (N=0,E=1,S=2,W=3).
pub fn sideInward(s: u2) V2 {
    return switch (s) {
        0 => .{ .x = 0, .y = 1 },
        1 => .{ .x = -1, .y = 0 },
        2 => .{ .x = 0, .y = -1 },
        3 => .{ .x = 1, .y = 0 },
    };
}

pub fn cornerPoint(c: u2) V2 {
    return switch (c) {
        0 => .{ .x = 0, .y = 0 },
        1 => .{ .x = 1, .y = 0 },
        2 => .{ .x = 1, .y = 1 },
        3 => .{ .x = 0, .y = 1 },
    };
}

pub fn distPointSeg(p: V2, a: V2, b: V2) F {
    const ab = b.sub(a);
    const l2 = ab.dot(ab);
    if (l2 < 1e-18) return p.dist(a);
    const t = std.math.clamp(p.sub(a).dot(ab) / l2, 0.0, 1.0);
    return p.dist(a.add(ab.scale(t)));
}

pub fn distPointPolyline(p: V2, pts: []const V2) F {
    var best: F = std.math.inf(F);
    if (pts.len == 1) return p.dist(pts[0]);
    var i: usize = 0;
    while (i + 1 < pts.len) : (i += 1) best = @min(best, distPointSeg(p, pts[i], pts[i + 1]));
    return best;
}

pub fn distPointRing(p: V2, pts: []const V2) F {
    var best: F = std.math.inf(F);
    for (pts, 0..) |a, i| {
        const b = pts[(i + 1) % pts.len];
        best = @min(best, distPointSeg(p, a, b));
    }
    return best;
}

/// Even-odd point in polygon.
pub fn pointInPoly(p: V2, poly: []const V2) bool {
    var inside = false;
    var j = poly.len -% 1;
    for (poly, 0..) |a, i| {
        const b = poly[j];
        if ((a.y > p.y) != (b.y > p.y)) {
            const xi = (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x;
            if (p.x < xi) inside = !inside;
        }
        j = i;
    }
    return inside;
}

pub fn signedArea(poly: []const V2) F {
    var s: F = 0;
    for (poly, 0..) |a, i| {
        const b = poly[(i + 1) % poly.len];
        s += a.x * b.y - b.x * a.y;
    }
    return s * 0.5;
}

pub fn polylineLength(pts: []const V2) F {
    var l: F = 0;
    var i: usize = 0;
    while (i + 1 < pts.len) : (i += 1) l += pts[i].dist(pts[i + 1]);
    return l;
}

/// Point and unit tangent at arc-length fraction `f` of a polyline.
pub fn polylineAt(pts: []const V2, f: F) struct { p: V2, t: V2 } {
    const total = polylineLength(pts);
    var target = std.math.clamp(f, 0, 1) * total;
    var i: usize = 0;
    while (i + 1 < pts.len) : (i += 1) {
        const l = pts[i].dist(pts[i + 1]);
        if (target <= l or i + 2 == pts.len) {
            const t = if (l > 0) std.math.clamp(target / l, 0, 1) else 0;
            return .{ .p = pts[i].lerp(pts[i + 1], t), .t = pts[i + 1].sub(pts[i]).norm() };
        }
        target -= l;
    }
    return .{ .p = pts[0], .t = .{ .x = 1, .y = 0 } };
}

/// Segment intersection: returns (t on ab, u on cd) when they intersect
/// within [0,1] x [0,1] and are not parallel.
pub fn segIntersect(a: V2, b: V2, c: V2, d: V2) ?struct { t: F, u: F } {
    const r = b.sub(a);
    const s = d.sub(c);
    const den = r.cross(s);
    if (@abs(den) < 1e-14) return null;
    const ca = c.sub(a);
    const t = ca.cross(s) / den;
    const u = ca.cross(r) / den;
    const e = 1e-9;
    if (t < -e or t > 1 + e or u < -e or u > 1 + e) return null;
    return .{ .t = std.math.clamp(t, 0, 1), .u = std.math.clamp(u, 0, 1) };
}

/// Intersection of infinite lines p + t*r and q + u*s.
pub fn lineIntersect(p: V2, r: V2, q: V2, s: V2) ?V2 {
    const den = r.cross(s);
    if (@abs(den) < 1e-9) return null;
    const t = q.sub(p).cross(s) / den;
    return p.add(r.scale(t));
}

// ---------------------------------------------------------------------------
// Deterministic hashing / noise (no global RNG; seeds come from tile ids).

pub fn hashStr(s: []const u8) u64 {
    // FNV-1a 64: tiny, stable, identical on every target.
    var h: u64 = 0xcbf29ce484222325;
    for (s) |c| {
        h ^= c;
        h *%= 0x100000001b3;
    }
    return h;
}

pub fn mix(a: u64, b: u64) u64 {
    var z = a +% b *% 0x9E3779B97F4A7C15;
    z = (z ^ (z >> 30)) *% 0xBF58476D1CE4E5B9;
    z = (z ^ (z >> 27)) *% 0x94D049BB133111EB;
    return z ^ (z >> 31);
}

/// Uniform in [0,1) from a hash.
pub fn unit(h: u64) F {
    return @as(F, @floatFromInt(h >> 11)) / @as(F, 9007199254740992.0);
}

/// Small deterministic stateful generator (splitmix64).
pub const Rng = struct {
    s: u64,
    pub fn init(seed: u64) Rng {
        return .{ .s = seed };
    }
    pub fn next(self: *Rng) u64 {
        self.s +%= 0x9E3779B97F4A7C15;
        return mix(self.s, 0);
    }
    pub fn float(self: *Rng) F {
        return unit(self.next());
    }
    pub fn range(self: *Rng, lo: F, hi: F) F {
        return lo + (hi - lo) * self.float();
    }
};

test "perimeter param round trip" {
    var t: F = 0.05;
    while (t < 4.0) : (t += 0.1) {
        const p = perimPoint(t);
        try std.testing.expectApproxEqAbs(t, perimParam(p), 1e-9);
    }
}

test "rotation maps N edge to E edge" {
    const p = rotQ(V2.init(0.5, 0), 1);
    try std.testing.expectApproxEqAbs(@as(F, 1), p.x, 1e-12);
    try std.testing.expectApproxEqAbs(@as(F, 0.5), p.y, 1e-12);
}
