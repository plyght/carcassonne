//! Procedural low-poly prop models (no art assets): houses, towers, chapel,
//! trees, bushes, animals, cart, mill, fountain, crops, duck, bridge,
//! gatehouse, wall stairs. Written once here so the web (render-three) and
//! the native desktop app draw identical props.
//!
//! Model space: tile units, +y up, yaw 0 faces +z, origin on the ground at
//! the prop's anchor (the `PROP` instance position of a 3D tile buffer).
//! Every vertex carries a palette `Part` (roof, plaster, stone, foliage...)
//! that the style maps to a colour, plus a baked `shade` factor (contact
//! darkening near the ground, darker roof undersides). Faces are flat
//! shaded: each triangle has its own normal, so vertices are only shared
//! between triangles of the same flat face (welded on exact equality).
//! Triangles are counter-clockwise seen from outside.

const std = @import("std");
const mesh = @import("mesh.zig");
const vec = @import("vec.zig");
const F = vec.F;
const Allocator = std.mem.Allocator;
const Prop = mesh.Prop;
const pi = std.math.pi;

/// Palette slots (per-vertex part id). Rows of a style's prop palette are
/// the instance `tint`.
pub const Part = enum(u8) {
    plaster = 0,
    roof = 1,
    stone = 2,
    stone_dark = 3,
    foliage = 4,
    trunk = 5,
    wood = 6,
    dark = 7,
    sheep = 8,
    cow = 9,
    crop = 10,
    water = 11,
    grass = 12,
};
/// Palette width reserved for parts (ids 13..15 unused).
pub const PART_COUNT: u8 = 16;

pub const Options = struct {
    /// Rounder silhouettes (more segments, smoother foliage) for toon styles.
    rounded: bool = false,
};

/// Distinct models per prop kind; a `variant` is taken modulo this.
pub fn variantCount(p: Prop) u8 {
    return switch (p) {
        .tower => 3,
        .house => 6,
        .tree => 2,
        .bush => 3,
        .round_tower => 3,
        else => 1,
    };
}

/// Uniform model scale on top of the authored sizes (chunky houses and
/// animals, like the reference miniatures). Already applied to the output.
pub fn baseScale(p: Prop) F {
    return switch (p) {
        .house => 1.3,
        .mill => 1.2,
        .sheep => 1.7,
        .cow => 1.6,
        .duck => 1.6,
        .bush => 1.25,
        .tree => 1.2,
        else => 1,
    };
}

/// Heights that line up with mesh.zig: city ground 0.012, wall top = 0.012 + WALL_H.
const WALL_TOP: F = 0.097;

const P3 = [3]F;

/// One emitted primitive (for the winding tests): its triangles must face
/// away from `center` (solid) or along `dir` (plate).
pub const Prim = struct {
    first: u32,
    count: u32,
    kind: enum { solid, plate },
    center: P3 = .{ 0, 0, 0 },
    dir: P3 = .{ 0, 0, 0 },
};

pub const Model = struct {
    pos: std.ArrayList([3]f32) = .empty,
    nrm: std.ArrayList([3]f32) = .empty,
    part: std.ArrayList(u8) = .empty,
    shade: std.ArrayList(f32) = .empty,
    indices: std.ArrayList(u32) = .empty,
    /// Primitive triangle ranges (triangle index = index / 3) for tests.
    prims: std.ArrayList(Prim) = .empty,
    variant: u8 = 0,
    min: [3]f32 = .{ 0, 0, 0 },
    max: [3]f32 = .{ 0, 0, 0 },

    pub fn deinit(self: *Model, a: Allocator) void {
        self.pos.deinit(a);
        self.nrm.deinit(a);
        self.part.deinit(a);
        self.shade.deinit(a);
        self.indices.deinit(a);
        self.prims.deinit(a);
    }
};

const RawTri = struct { p: [3]P3, n: P3, part: u8, shade: F };

const Builder = struct {
    a: Allocator,
    rounded: bool,
    tris: std.ArrayList(RawTri) = .empty,
    prims: std.ArrayList(Prim) = .empty,

    fn segs(self: *const Builder) u32 {
        return if (self.rounded) 14 else 8;
    }

    fn begin(self: *Builder) u32 {
        return @intCast(self.tris.items.len);
    }
    fn endSolid(self: *Builder, first: u32, center: P3) !void {
        try self.prims.append(self.a, .{ .first = first, .count = @as(u32, @intCast(self.tris.items.len)) - first, .kind = .solid, .center = center });
    }

    fn tri(self: *Builder, a: P3, b: P3, c: P3, part: Part, shade: F) !void {
        const u = sub(b, a);
        const v = sub(c, a);
        const n = cross(u, v);
        const l = @sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]);
        if (l < 1e-12) return; // degenerate (e.g. a pyramid's ridge quad): invisible, skip
        try self.tris.append(self.a, .{ .p = .{ a, b, c }, .n = .{ n[0] / l, n[1] / l, n[2] / l }, .part = @backingInt(part), .shade = shade });
    }

    fn quad(self: *Builder, a: P3, b: P3, c: P3, d: P3, part: Part, shade: F) !void {
        try self.tri(a, b, c, part, shade);
        try self.tri(a, c, d, part, shade);
    }

    const BoxOpt = struct { bottom: bool = false, yaw: F = 0, top: bool = true };

    /// Box centred at (cx, *, cz) from y0 to y1, rotated by `yaw` about its centre.
    fn box(self: *Builder, cx: F, cz: F, hx: F, hz: F, y0: F, y1: F, part: Part, opt: BoxOpt) !void {
        const first = self.begin();
        const c = @cos(opt.yaw);
        const s = @sin(opt.yaw);
        const P = struct {
            fn f(cx_: F, cz_: F, c_: F, s_: F, x: F, z: F) [2]F {
                return .{ cx_ + x * c_ + z * s_, cz_ - x * s_ + z * c_ };
            }
        }.f;
        const p = [4][2]F{ P(cx, cz, c, s, -hx, -hz), P(cx, cz, c, s, hx, -hz), P(cx, cz, c, s, hx, hz), P(cx, cz, c, s, -hx, hz) };
        for (0..4) |i| {
            const a = p[i];
            const b = p[(i + 1) % 4];
            try self.quad(.{ b[0], y0, b[1] }, .{ a[0], y0, a[1] }, .{ a[0], y1, a[1] }, .{ b[0], y1, b[1] }, part, 1);
        }
        if (opt.top) try self.quad(.{ p[3][0], y1, p[3][1] }, .{ p[2][0], y1, p[2][1] }, .{ p[1][0], y1, p[1][1] }, .{ p[0][0], y1, p[0][1] }, part, 1);
        if (opt.bottom) try self.quad(.{ p[0][0], y0, p[0][1] }, .{ p[1][0], y0, p[1][1] }, .{ p[2][0], y0, p[2][1] }, .{ p[3][0], y0, p[3][1] }, part, 1);
        try self.endSolid(first, .{ cx, (y0 + y1) / 2, cz });
    }

    fn rot(cx: F, cz: F, yaw: F, x: F, y: F, z: F) P3 {
        const c = @cos(yaw);
        const s = @sin(yaw);
        return .{ cx + x * c + z * s, y, cz - x * s + z * c };
    }

    /// Gable roof over a box footprint; ridge along local x.
    fn gable(self: *Builder, cx: F, cz: F, hx: F, hz: F, y0: F, h: F, part: Part, gable_part: Part, yaw: F) !void {
        const first = self.begin();
        const o: F = 0.0075; // overhang
        const a = rot(cx, cz, yaw, -hx - o, y0 - 0.003, -hz - o);
        const b = rot(cx, cz, yaw, hx + o, y0 - 0.003, -hz - o);
        const cc = rot(cx, cz, yaw, hx + o, y0 - 0.003, hz + o);
        const d = rot(cx, cz, yaw, -hx - o, y0 - 0.003, hz + o);
        const r0 = rot(cx, cz, yaw, -hx - o, y0 + h, 0);
        const r1 = rot(cx, cz, yaw, hx + o, y0 + h, 0);
        try self.quad(b, a, r0, r1, part, 1);
        try self.quad(d, cc, r1, r0, part, 1);
        // gable ends (wall-coloured triangles, inset under the overhang)
        try self.tri(rot(cx, cz, yaw, -hx, y0, -hz), rot(cx, cz, yaw, -hx, y0, hz), rot(cx, cz, yaw, -hx, y0 + h * 0.95, 0), gable_part, 1);
        try self.tri(rot(cx, cz, yaw, hx, y0, hz), rot(cx, cz, yaw, hx, y0, -hz), rot(cx, cz, yaw, hx, y0 + h * 0.95, 0), gable_part, 1);
        // underside of the overhang
        try self.quad(a, b, cc, d, part, 0.6);
        try self.endSolid(first, .{ cx, y0 + h * 0.3, cz });
    }

    /// Hip / pyramid roof (ridge half-length `ridge` along local x).
    fn hip(self: *Builder, cx: F, cz: F, hx: F, hz: F, y0: F, h: F, part: Part, ridge: F, yaw: F) !void {
        const first = self.begin();
        const o: F = 0.005;
        const a = rot(cx, cz, yaw, -hx - o, y0 - 0.003, -hz - o);
        const b = rot(cx, cz, yaw, hx + o, y0 - 0.003, -hz - o);
        const cc = rot(cx, cz, yaw, hx + o, y0 - 0.003, hz + o);
        const d = rot(cx, cz, yaw, -hx - o, y0 - 0.003, hz + o);
        const r0 = rot(cx, cz, yaw, -ridge, y0 + h, 0);
        const r1 = rot(cx, cz, yaw, ridge, y0 + h, 0);
        try self.quad(b, a, r0, r1, part, 1);
        try self.quad(d, cc, r1, r0, part, 1);
        try self.tri(a, d, r0, part, 1);
        try self.tri(cc, b, r1, part, 1);
        try self.quad(a, b, cc, d, part, 0.6);
        try self.endSolid(first, .{ cx, y0 + h * 0.3, cz });
    }

    /// Open-bottomed (tapered) cylinder with a flat top cap.
    fn cylinder(self: *Builder, cx: F, cz: F, r: F, y0: F, y1: F, part: Part, sides: u32, r_top: F) !void {
        const first = self.begin();
        const n: F = @floatFromInt(sides);
        for (0..sides) |i| {
            const a0 = @as(F, @floatFromInt(i)) / n * pi * 2;
            const a1 = @as(F, @floatFromInt(i + 1)) / n * pi * 2;
            const p0 = P3{ cx + r * @sin(a0), y0, cz + r * @cos(a0) };
            const p1 = P3{ cx + r * @sin(a1), y0, cz + r * @cos(a1) };
            const q0 = P3{ cx + r_top * @sin(a0), y1, cz + r_top * @cos(a0) };
            const q1 = P3{ cx + r_top * @sin(a1), y1, cz + r_top * @cos(a1) };
            try self.quad(p0, p1, q1, q0, part, 1);
            try self.tri(.{ cx, y1, cz }, q0, q1, part, 1);
        }
        try self.endSolid(first, .{ cx, (y0 + y1) / 2, cz });
    }

    fn cone(self: *Builder, cx: F, cz: F, r: F, y0: F, h: F, part: Part, sides: u32) !void {
        const first = self.begin();
        const apex = P3{ cx, y0 + h, cz };
        const n: F = @floatFromInt(sides);
        for (0..sides) |i| {
            const a0 = @as(F, @floatFromInt(i)) / n * pi * 2;
            const a1 = @as(F, @floatFromInt(i + 1)) / n * pi * 2;
            const p0 = P3{ cx + r * @sin(a0), y0, cz + r * @cos(a0) };
            const p1 = P3{ cx + r * @sin(a1), y0, cz + r * @cos(a1) };
            try self.tri(p0, p1, apex, part, 1);
            try self.tri(.{ cx, y0, cz }, p1, p0, part, 0.6);
        }
        try self.endSolid(first, .{ cx, y0 + h * 0.25, cz });
    }

    /// Low-poly lumpy blob (squashed, jittered icosphere) for foliage and wool.
    fn blob(self: *Builder, cx: F, cy: F, cz: F, r: F, sy: F, part: Part, seed: F) !void {
        const first = self.begin();
        const detail: u32 = if (self.rounded) 2 else 1;
        const amp: F = if (self.rounded) 0.4 else 1;
        const Ctx = struct {
            b: *Builder,
            cx: F,
            cy: F,
            cz: F,
            r: F,
            sy: F,
            seed: F,
            amp: F,
            part: Part,
            fn map(c: @This(), v: P3) P3 {
                // unit-sphere vertex, rounded to f32 like a BufferAttribute
                const l = @sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
                const x: F = @as(f32, @floatCast(v[0] / l));
                const y: F = @as(f32, @floatCast(v[1] / l));
                const z: F = @as(f32, @floatCast(v[2] / l));
                // deterministic lumpy jitter
                const j = 1 + 0.12 * @sin(x * 7.1 + c.seed) * @cos(z * 5.3 + c.seed * 1.7) * c.amp;
                return .{ c.cx + x * c.r * j, c.cy + y * c.r * c.sy * j, c.cz + z * c.r * j };
            }
            fn face(c: @This(), a: P3, b: P3, cc: P3) !void {
                try c.b.tri(c.map(a), c.map(b), c.map(cc), c.part, 1);
            }
        };
        const ctx = Ctx{ .b = self, .cx = cx, .cy = cy, .cz = cz, .r = r, .sy = sy, .seed = seed, .amp = amp, .part = part };
        // three.js IcosahedronGeometry(1, detail): same vertices, faces and subdivision order
        const t: F = (1 + @sqrt(@as(F, 5))) / 2;
        const V = [12]P3{
            .{ -1, t, 0 }, .{ 1, t, 0 }, .{ -1, -t, 0 }, .{ 1, -t, 0 },
            .{ 0, -1, t }, .{ 0, 1, t }, .{ 0, -1, -t }, .{ 0, 1, -t },
            .{ t, 0, -1 }, .{ t, 0, 1 }, .{ -t, 0, -1 }, .{ -t, 0, 1 },
        };
        const I = [60]u8{
            0, 11, 5, 0, 5,  1,  0,  1,  7,  0,  7, 10, 0, 10, 11,
            1, 5,  9, 5, 11, 4,  11, 10, 2,  10, 7, 6,  7, 1,  8,
            3, 9,  4, 3, 4,  2,  3,  2,  6,  3,  6, 8,  3, 8,  9,
            4, 9,  5, 2, 4,  11, 6,  2,  10, 8,  6, 7,  9, 8,  1,
        };
        const cols = detail + 1;
        const fc: F = @floatFromInt(cols);
        var f: usize = 0;
        while (f < I.len) : (f += 3) {
            const a = V[I[f]];
            const b = V[I[f + 1]];
            const c = V[I[f + 2]];
            var grid: [4][4]P3 = undefined;
            for (0..cols + 1) |i| {
                const ti = @as(F, @floatFromInt(i)) / fc;
                const aj = lerp(a, c, ti);
                const bj = lerp(b, c, ti);
                const rows = cols - i;
                for (0..rows + 1) |j| {
                    grid[i][j] = if (j == 0 and i == cols) aj else lerp(aj, bj, @as(F, @floatFromInt(j)) / @as(F, @floatFromInt(rows)));
                }
            }
            for (0..cols) |i| {
                for (0..2 * (cols - i) - 1) |j| {
                    const k = j / 2;
                    if (j % 2 == 0) {
                        try ctx.face(grid[i][k + 1], grid[i + 1][k], grid[i][k]);
                    } else {
                        try ctx.face(grid[i][k + 1], grid[i + 1][k + 1], grid[i + 1][k]);
                    }
                }
            }
        }
        try self.endSolid(first, .{ cx, cy, cz });
    }

    /// Thin rectangle on a vertical face (window / door) facing `yaw_face`.
    fn plate(self: *Builder, cx: F, cz: F, y0: F, y1: F, hw: F, yaw_face: F, part: Part) !void {
        const first = self.begin();
        const out: F = 0.0012;
        const nx = @sin(yaw_face);
        const nz = @cos(yaw_face);
        const tx = @cos(yaw_face);
        const tz = -@sin(yaw_face);
        const ox = cx + nx * out;
        const oz = cz + nz * out;
        try self.quad(.{ ox - tx * hw, y0, oz - tz * hw }, .{ ox + tx * hw, y0, oz + tz * hw }, .{ ox + tx * hw, y1, oz + tz * hw }, .{ ox - tx * hw, y1, oz - tz * hw }, part, 1);
        try self.prims.append(self.a, .{ .first = first, .count = @as(u32, @intCast(self.tris.items.len)) - first, .kind = .plate, .dir = .{ nx, 0, nz } });
    }

    /// Merlons around the top rim of a box.
    fn crenels(self: *Builder, cx: F, cz: F, hx: F, hz: F, y: F, h: F, part: Part) !void {
        const m: F = 0.009;
        const nx: u32 = @max(2, @as(u32, @intFromFloat(jsRound((hx * 2) / (m * 2.2)))));
        const nz: u32 = @max(2, @as(u32, @intFromFloat(jsRound((hz * 2) / (m * 2.2)))));
        for (0..nx) |i| {
            const x = -hx + m * 0.5 + (@as(F, @floatFromInt(i)) * (2 * hx - m)) / @as(F, @floatFromInt(nx - 1));
            try self.box(cx + x, cz - hz + m * 0.5, m * 0.5, m * 0.5, y, y + h, part, .{});
            try self.box(cx + x, cz + hz - m * 0.5, m * 0.5, m * 0.5, y, y + h, part, .{});
        }
        for (1..nz - 1) |i| {
            const z = -hz + m * 0.5 + (@as(F, @floatFromInt(i)) * (2 * hz - m)) / @as(F, @floatFromInt(nz - 1));
            try self.box(cx - hx + m * 0.5, cz + z, m * 0.5, m * 0.5, y, y + h, part, .{});
            try self.box(cx + hx - m * 0.5, cz + z, m * 0.5, m * 0.5, y, y + h, part, .{});
        }
    }

    fn ringCrenels(self: *Builder, cx: F, cz: F, r: F, y: F, h: F, part: Part) !void {
        const n: u32 = if (self.rounded) 10 else 8;
        for (0..n) |i| {
            const a = @as(F, @floatFromInt(i)) / @as(F, @floatFromInt(n)) * pi * 2;
            try self.box(cx + @sin(a) * (r - 0.005), cz + @cos(a) * (r - 0.005), 0.0055, 0.0045, y, y + h, part, .{ .yaw = a });
        }
    }
};

fn sub(a: P3, b: P3) P3 {
    return .{ a[0] - b[0], a[1] - b[1], a[2] - b[2] };
}
fn cross(u: P3, v: P3) P3 {
    return .{ u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0] };
}
fn lerp(a: P3, b: P3, t: F) P3 {
    return .{ a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t };
}
/// JavaScript Math.round for non-negative values.
fn jsRound(x: F) F {
    return @floor(x + 0.5);
}

// --- models ------------------------------------------------------------------

fn windows(b: *Builder, cx: F, cz: F, hx: F, hz: F, y: F, yaw: F, door: bool) !void {
    const c = @cos(yaw);
    const s = @sin(yaw);
    const ww: F = 0.0045;
    for ([_]F{ 1, -1 }) |side| {
        const n: u32 = @max(1, @as(u32, @intFromFloat(@floor((hx * 2) / 0.028))));
        for (0..n) |i| {
            const x = -hx + ((@as(F, @floatFromInt(i)) + 0.5) * 2 * hx) / @as(F, @floatFromInt(n));
            const z = side * hz;
            const px = cx + x * c + z * s;
            const pz = cz - x * s + z * c;
            const face: F = yaw + (if (side == 1) @as(F, 0) else pi);
            if (door and side == 1 and i == 0) {
                try b.plate(px, pz, 0, @min(y * 0.62, 0.022), ww * 1.2, face, .dark);
            } else {
                try b.plate(px, pz, y * 0.52, y * 0.52 + 0.009, ww, face, .dark);
            }
        }
    }
}

fn house(b: *Builder, v: u8) !void {
    const P = Part.plaster;
    const R = Part.roof;
    switch (v) {
        0 => { // long house
            try b.box(0, 0, 0.042, 0.027, -0.01, 0.036, P, .{});
            try b.gable(0, 0, 0.042, 0.027, 0.036, 0.032, R, P, 0);
            try windows(b, 0, 0, 0.042, 0.027, 0.036, 0, true);
        },
        1 => { // square house, hip roof
            try b.box(0, 0, 0.032, 0.03, -0.01, 0.038, P, .{});
            try b.hip(0, 0, 0.032, 0.03, 0.038, 0.036, R, 0.006, 0);
            try windows(b, 0, 0, 0.032, 0.03, 0.038, 0, true);
        },
        2 => { // tall narrow town house
            try b.box(0, 0, 0.026, 0.025, -0.01, 0.058, P, .{});
            try b.gable(0, 0, 0.026, 0.025, 0.058, 0.03, R, P, pi / 2.0);
            try windows(b, 0, 0, 0.026, 0.025, 0.058, 0, true);
            try b.plate(0, 0.025, 0.038, 0.047, 0.0045, 0, .dark);
        },
        3 => { // L-shaped
            try b.box(0.008, -0.008, 0.036, 0.021, -0.01, 0.036, P, .{});
            try b.gable(0.008, -0.008, 0.036, 0.021, 0.036, 0.027, R, P, 0);
            try b.box(-0.018, 0.016, 0.019, 0.024, -0.01, 0.031, P, .{});
            try b.gable(-0.018, 0.016, 0.019, 0.024, 0.031, 0.024, R, P, pi / 2.0);
            try windows(b, 0.008, -0.008, 0.036, 0.021, 0.036, 0, false);
        },
        4 => { // house with chimney
            try b.box(0, 0, 0.038, 0.026, -0.01, 0.034, P, .{});
            try b.gable(0, 0, 0.038, 0.026, 0.034, 0.03, R, P, 0);
            try b.box(0.022, 0.008, 0.005, 0.005, 0.04, 0.074, .stone_dark, .{});
            try windows(b, 0, 0, 0.038, 0.026, 0.034, 0, true);
        },
        else => { // two storeys with a jettied upper floor
            try b.box(0, 0, 0.033, 0.024, -0.01, 0.028, P, .{});
            try b.box(0, 0, 0.037, 0.028, 0.028, 0.054, P, .{});
            try b.gable(0, 0, 0.037, 0.028, 0.054, 0.032, R, P, 0);
            try windows(b, 0, 0, 0.037, 0.028, 0.06, 0, true);
        },
    }
}

fn tower(b: *Builder, v: u8) !void {
    const S = Part.stone;
    const h: F = 0.14;
    const hw: F = 0.03;
    try b.box(0, 0, hw, hw, -0.012, h, S, .{});
    for ([_]F{ 0, pi / 2.0, pi, -pi / 2.0 }) |yaw| {
        try b.plate(@sin(yaw) * hw, @cos(yaw) * hw, h * 0.55, h * 0.55 + 0.016, 0.003, yaw, .dark);
    }
    if (v == 1) {
        try b.hip(0, 0, hw, hw, h, 0.05, .roof, 0, 0);
    } else {
        try b.box(0, 0, hw + 0.004, hw + 0.004, h - 0.012, h, S, .{});
        try b.crenels(0, 0, hw + 0.004, hw + 0.004, h, 0.013, S);
    }
}

fn roundTower(b: *Builder, v: u8) !void {
    const S = Part.stone;
    const h: F = 0.135;
    const r: F = 0.033;
    const sides = b.segs() + 2;
    try b.cylinder(0, 0, r * 1.06, -0.012, 0.03, S, sides, r);
    try b.cylinder(0, 0, r, 0.03, h, S, sides, r);
    for ([_]F{ 0.4, 2.5, 4.4 }) |yaw| try b.plate(@sin(yaw) * r, @cos(yaw) * r, h * 0.6, h * 0.6 + 0.015, 0.003, yaw, .dark);
    if (v == 1) {
        try b.cylinder(0, 0, r + 0.004, h - 0.01, h, S, sides, r + 0.004);
        try b.ringCrenels(0, 0, r + 0.004, h, 0.013, S);
    } else {
        try b.cone(0, 0, r + 0.008, h, if (v == 0) 0.065 else 0.05, .roof, sides);
    }
}

fn gatehouse(b: *Builder) !void {
    // Road runs along local z; the wall runs along x.
    const S = Part.stone;
    const h: F = 0.13;
    const hz: F = 0.034;
    const pier: F = 0.024;
    const open: F = 0.033; // half opening (road half width ~0.055 with margin)
    for ([_]F{ -1, 1 }) |sx| {
        try b.box(sx * (open + pier), 0, pier, hz, -0.012, h, S, .{});
        try b.crenels(sx * (open + pier), 0, pier, hz, h, 0.013, S);
    }
    // arch lintel and walk-way above the opening
    try b.box(0, 0, open, hz, 0.075, h - 0.01, S, .{ .bottom = true });
    try b.box(0, 0, open + 0.004, hz * 0.9, h - 0.012, h - 0.004, .stone_dark, .{});
}

fn wallStairs(b: *Builder) !void {
    const n: F = 6;
    for (0..6) |i| {
        const fi: F = @floatFromInt(i);
        const x0 = -0.03 + (fi * 0.06) / n;
        try b.box(x0 + 0.005, 0, 0.005, 0.011, -0.005, 0.012 + ((fi + 1) * (WALL_TOP - 0.02)) / n, .stone, .{});
    }
}

fn chapel(b: *Builder) !void {
    // cloister / abbey: nave, bell tower, arcade
    const P = Part.plaster;
    const R = Part.roof;
    try b.box(-0.01, 0, 0.07, 0.045, -0.01, 0.06, P, .{});
    try b.gable(-0.01, 0, 0.07, 0.045, 0.06, 0.045, R, P, 0);
    // arcade along the front (+z)
    for (0..5) |i| try b.plate(-0.065 + @as(F, @floatFromInt(i)) * 0.027, 0.045, 0.0, 0.032, 0.0075, 0, .dark);
    for (0..4) |i| try b.plate(-0.06 + @as(F, @floatFromInt(i)) * 0.033, 0.045, 0.042, 0.052, 0.004, 0, .dark);
    // bell tower at +x
    try b.box(0.075, 0, 0.026, 0.026, -0.01, 0.13, P, .{});
    try b.plate(0.075, 0.026, 0.095, 0.115, 0.008, 0, .dark);
    try b.plate(0.101, 0, 0.095, 0.115, 0.008, pi / 2.0, .dark);
    try b.hip(0.075, 0, 0.026, 0.026, 0.13, 0.05, R, 0, 0);
    // side wing (cloister range)
    try b.box(-0.055, -0.07, 0.035, 0.025, -0.01, 0.04, P, .{});
    try b.gable(-0.055, -0.07, 0.035, 0.025, 0.04, 0.026, R, P, 0);
}

fn tree(b: *Builder, v: u8) !void {
    try b.cylinder(0, 0, 0.005, 0, 0.02, .trunk, 5, 0.005);
    if (v == 0) {
        try b.blob(0, 0.04, 0, 0.024, 1.05, .foliage, 1.3);
    } else {
        try b.blob(0, 0.036, 0, 0.02, 1, .foliage, 2.1);
        try b.blob(0.012, 0.05, 0.006, 0.016, 1, .foliage, 3.7);
    }
}

fn bush(b: *Builder, v: u8) !void {
    switch (v) {
        0 => try b.blob(0, 0.008, 0, 0.0135, 0.85, .foliage, 0.7),
        1 => {
            try b.blob(-0.006, 0.007, 0, 0.012, 0.85, .foliage, 1.9);
            try b.blob(0.008, 0.006, 0.004, 0.01, 0.8, .foliage, 2.6);
        },
        else => try b.blob(0, 0.01, 0, 0.016, 0.9, .foliage, 3.3),
    }
}

fn sheep(b: *Builder) !void {
    try b.blob(0, 0.011, 0, 0.0085, 0.75, .sheep, 0.3);
    try b.box(0, 0.011, 0.003, 0.0035, 0.008, 0.016, .dark, .{});
    for ([_][2]F{ .{ -0.004, -0.004 }, .{ 0.004, -0.004 }, .{ -0.004, 0.004 }, .{ 0.004, 0.004 } }) |l|
        try b.box(l[0], l[1], 0.0012, 0.0012, 0, 0.006, .dark, .{});
}

fn cow(b: *Builder) !void {
    try b.box(0, 0, 0.0065, 0.013, 0.007, 0.018, .cow, .{});
    try b.box(0, 0.016, 0.004, 0.004, 0.012, 0.02, .cow, .{});
    for ([_][2]F{ .{ -0.004, -0.009 }, .{ 0.004, -0.009 }, .{ -0.004, 0.009 }, .{ 0.004, 0.009 } }) |l|
        try b.box(l[0], l[1], 0.0016, 0.0016, 0, 0.008, .dark, .{});
}

fn crop(b: *Builder) !void {
    // subtle crop strips: low furrows
    for (0..4) |i| try b.box(0, -0.018 + @as(F, @floatFromInt(i)) * 0.012, 0.03, 0.0035, -0.002, 0.003, .crop, .{});
}

fn mill(b: *Builder) !void {
    try b.box(0, 0, 0.03, 0.024, -0.01, 0.05, .plaster, .{});
    try b.gable(0, 0, 0.03, 0.024, 0.05, 0.03, .roof, .plaster, 0);
    try windows(b, 0, 0, 0.03, 0.024, 0.05, 0, true);
    // water wheel on the -x side, axis along x
    const wx: F = -0.036;
    const r: F = 0.026;
    for (0..10) |i| {
        const a = @as(F, @floatFromInt(i)) / 10.0 * pi * 2;
        try b.box(wx, @cos(a) * r * 0.9, 0.006, 0.003, 0.025 + @sin(a) * r - 0.006, 0.025 + @sin(a) * r + 0.006, .wood, .{});
    }
    try b.box(wx, 0, 0.007, 0.004, 0.02, 0.03, .wood, .{});
}

fn fountain(b: *Builder) !void {
    const s = b.segs() + 4;
    try b.cylinder(0, 0, 0.036, -0.004, 0.012, .stone, s, 0.036);
    try b.cylinder(0, 0, 0.03, 0.006, 0.0125, .water, s, 0.03);
    try b.cylinder(0, 0, 0.006, 0.01, 0.034, .stone, 6, 0.006);
    try b.cylinder(0, 0, 0.012, 0.03, 0.035, .stone, 8, 0.012);
}

fn duck(b: *Builder) !void {
    try b.blob(0, 0.002, 0, 0.005, 0.6, .sheep, 0.1);
    try b.blob(0, 0.006, 0.004, 0.0025, 1, .foliage, 0.2);
}

fn cart(b: *Builder) !void {
    try b.box(0, 0, 0.008, 0.014, 0.006, 0.014, .wood, .{});
    for ([_]F{ -1, 1 }) |sx| try b.box(sx * 0.0095, 0, 0.0015, 0.006, 0, 0.012, .dark, .{});
    try b.box(0, 0.02, 0.001, 0.008, 0.008, 0.01, .wood, .{});
    try b.blob(0, 0.016, -0.004, 0.006, 0.7, .crop, 0.5);
}

fn bridge(b: *Builder) !void {
    // deck along local z (the road), parapets on both sides
    try b.box(0, 0, 0.06, 0.1, -0.012, 0.004, .stone, .{});
    for ([_]F{ -1, 1 }) |sx| try b.box(sx * 0.056, 0, 0.005, 0.1, 0.004, 0.014, .stone_dark, .{});
}

const WeldKey = struct { p: [3]u32, n: [3]u32, part: u8, shade: u32 };

/// Builds the model for (prop, variant % variantCount) in final model space
/// (base scale applied). Deterministic: a pure function of its arguments.
pub fn build(a: Allocator, prop: Prop, variant: u8, opts: Options) !Model {
    var b = Builder{ .a = a, .rounded = opts.rounded };
    defer b.tris.deinit(a);
    errdefer b.prims.deinit(a);
    const v = variant % variantCount(prop);
    switch (prop) {
        .tower => try tower(&b, v),
        .house => try house(&b, v),
        .chapel => try chapel(&b),
        .tree => try tree(&b, v),
        .sheep => try sheep(&b),
        .cow => try cow(&b),
        .cart => try cart(&b),
        .mill => try mill(&b),
        .fountain => try fountain(&b),
        .crop => try crop(&b),
        .duck => try duck(&b),
        .bridge => try bridge(&b),
        .bush => try bush(&b, v),
        .gatehouse => try gatehouse(&b),
        .round_tower => try roundTower(&b, v),
        .wall_stairs => try wallStairs(&b),
    }

    var m = Model{ .variant = v, .prims = b.prims };
    errdefer m.deinit(a);
    const k = baseScale(prop);
    var weld: std.AutoHashMapUnmanaged(WeldKey, u32) = .empty;
    defer weld.deinit(a);
    var lo = [3]f32{ std.math.inf(f32), std.math.inf(f32), std.math.inf(f32) };
    var hi = [3]f32{ -std.math.inf(f32), -std.math.inf(f32), -std.math.inf(f32) };
    for (b.tris.items) |t| {
        const n: [3]f32 = .{ @floatCast(t.n[0]), @floatCast(t.n[1]), @floatCast(t.n[2]) };
        for (t.p) |p| {
            // baked contact darkening near the ground (authored units, before scaling)
            const sh: f32 = @floatCast(t.shade * (0.72 + 0.28 * std.math.clamp(p[1] / 0.03, 0, 1)));
            const q: [3]f32 = .{ @floatCast(p[0] * k), @floatCast(p[1] * k), @floatCast(p[2] * k) };
            const key = WeldKey{ .p = @bitCast(q), .n = @bitCast(n), .part = t.part, .shade = @bitCast(sh) };
            const gop = try weld.getOrPut(a, key);
            if (!gop.found_existing) {
                gop.value_ptr.* = @intCast(m.pos.items.len);
                try m.pos.append(a, q);
                try m.nrm.append(a, n);
                try m.part.append(a, t.part);
                try m.shade.append(a, sh);
                for (0..3) |i| {
                    lo[i] = @min(lo[i], q[i]);
                    hi[i] = @max(hi[i], q[i]);
                }
            }
            try m.indices.append(a, gop.value_ptr.*);
        }
    }
    m.min = lo;
    m.max = hi;
    return m;
}

// --- tests -------------------------------------------------------------------

const testing = std.testing;
const buffer = @import("buffer.zig");

fn allProps() []const Prop {
    return comptime std.enums.values(Prop);
}

test "prop meshes: indices in range, unit normals, valid parts, outward winding" {
    const a = testing.allocator;
    for ([_]bool{ false, true }) |rounded| for (allProps()) |prop| for (0..variantCount(prop)) |vi| {
        var m = try build(a, prop, @intCast(vi), .{ .rounded = rounded });
        defer m.deinit(a);
        errdefer std.debug.print("prop {s} variant {d} rounded {}\n", .{ @tagName(prop), vi, rounded });
        const nv = m.pos.items.len;
        try testing.expect(nv > 0);
        try testing.expectEqual(nv, m.nrm.items.len);
        try testing.expectEqual(nv, m.part.items.len);
        try testing.expectEqual(nv, m.shade.items.len);
        try testing.expect(m.indices.items.len > 0 and m.indices.items.len % 3 == 0);
        for (m.indices.items) |i| try testing.expect(i < nv);
        for (m.nrm.items) |n| try testing.expectApproxEqAbs(@as(f32, 1), @sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]), 1e-4);
        for (m.part.items) |p| {
            try testing.expect(p < PART_COUNT);
            try testing.expect(p <= @backingInt(Part.grass));
        }
        for (m.shade.items) |s| try testing.expect(s > 0.3 and s <= 1.0);
        // every triangle: non-degenerate, and its stored normal agrees with
        // its counter-clockwise winding (no inverted faces)
        const ntri = m.indices.items.len / 3;
        for (0..ntri) |t| {
            const ix = m.indices.items[t * 3 ..][0..3];
            const p0 = m.pos.items[ix[0]];
            const e1 = [3]f32{ m.pos.items[ix[1]][0] - p0[0], m.pos.items[ix[1]][1] - p0[1], m.pos.items[ix[1]][2] - p0[2] };
            const e2 = [3]f32{ m.pos.items[ix[2]][0] - p0[0], m.pos.items[ix[2]][1] - p0[1], m.pos.items[ix[2]][2] - p0[2] };
            const c = [3]f32{ e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0] };
            const cl = @sqrt(c[0] * c[0] + c[1] * c[1] + c[2] * c[2]);
            try testing.expect(cl > 0);
            for (ix) |i| {
                const n = m.nrm.items[i];
                try testing.expect((c[0] * n[0] + c[1] * n[1] + c[2] * n[2]) / cl > 0.99);
            }
        }
        // every primitive faces outward: solids away from their centre,
        // window/door plates along their facing direction
        const k = baseScale(prop);
        var covered: usize = 0;
        for (m.prims.items) |pr| {
            covered += pr.count;
            for (pr.first..pr.first + pr.count) |t| {
                const ix = m.indices.items[t * 3 ..][0..3];
                const n = m.nrm.items[ix[0]];
                switch (pr.kind) {
                    .solid => {
                        var d: F = 0;
                        for (0..3) |axis| {
                            const cen = (@as(F, m.pos.items[ix[0]][axis]) + m.pos.items[ix[1]][axis] + m.pos.items[ix[2]][axis]) / 3;
                            d += (cen - pr.center[axis] * k) * n[axis];
                        }
                        if (d <= 0) return error.InvertedFace;
                    },
                    .plate => if (n[0] * pr.dir[0] + n[1] * pr.dir[1] + n[2] * pr.dir[2] < 0.99) return error.InvertedFace,
                }
            }
        }
        try testing.expectEqual(ntri, covered);
    };
}

test "prop meshes are deterministic and variants wrap" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator); // CGEO builders are arena-backed
    defer arena.deinit();
    const a = arena.allocator();
    for (allProps()) |prop| {
        const n = variantCount(prop);
        for (0..n) |vi| {
            const v: u8 = @intCast(vi);
            const x = try buffer.encodeProp(a, prop, v, .{});
            defer a.free(x);
            const y = try buffer.encodeProp(a, prop, v, .{});
            defer a.free(y);
            const z = try buffer.encodeProp(a, prop, v + n, .{});
            defer a.free(z);
            try testing.expectEqualSlices(u8, x, y);
            try testing.expectEqualSlices(u8, x, z);
        }
    }
    // rounded models differ for round shapes
    const r0 = try buffer.encodeProp(a, .tree, 0, .{});
    defer a.free(r0);
    const r1 = try buffer.encodeProp(a, .tree, 0, .{ .rounded = true });
    defer a.free(r1);
    try testing.expect(!std.mem.eql(u8, r0, r1));
}

test "prop buffer layout" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const bytes = try buffer.encodeProp(a, .house, 7, .{ .rounded = true });
    defer a.free(bytes);
    const r = buffer.Reader{ .bytes = bytes };
    try testing.expectEqual(buffer.KIND_PROP, r.kind());
    const dim = r.find(buffer.tag("PDIM")).?;
    try testing.expectEqual(@as(usize, 32), dim.data.len);
    try testing.expectEqual(@as(u8, @backingInt(Prop.house)), dim.data[0]);
    try testing.expectEqual(@as(u8, 1), dim.data[1]); // 7 % 6
    try testing.expectEqual(@as(u8, 6), dim.data[2]);
    try testing.expectEqual(@as(u8, 1), dim.data[3]);
    const nv = r.find(buffer.tag("VPOS")).?.count;
    try testing.expectEqual(nv, r.find(buffer.tag("VNRM")).?.count);
    try testing.expectEqual(nv, r.find(buffer.tag("VPRT")).?.count);
    try testing.expectEqual(nv, r.find(buffer.tag("VSHD")).?.count);
    const idx = r.find(buffer.tag("INDX")).?;
    for (0..idx.count) |i| try testing.expect(buffer.Reader.u32At(idx.data, i) < nv);
    // a house has roof, plaster and dark window parts, and is sunk into the ground
    const prt = r.find(buffer.tag("VPRT")).?.data;
    var seen: [PART_COUNT]bool = @splat(false);
    for (prt[0..nv]) |p| seen[p] = true;
    try testing.expect(seen[@backingInt(Part.roof)] and seen[@backingInt(Part.plaster)] and seen[@backingInt(Part.dark)]);
    try testing.expect(buffer.Reader.f32At(dim.data, 3) < 0); // min y
}
