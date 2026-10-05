//! Tile schema shared by engine, ai and geo. OWNED BY THE CONTRACT (docs/CONTRACT.md):
//! change only with coordination.
//!
//! Each tile edge is split into 3 "ports", numbered clockwise starting at the
//! north edge's west end:
//!
//!        0  1  2
//!     11 +-----+ 3
//!     10 |     | 4
//!      9 +-----+ 5
//!        8  7  6
//!
//! Side s (N=0,E=1,S=2,W=3) owns ports 3s, 3s+1, 3s+2. The middle port (3s+1)
//! carries roads/rivers; the outer ports carry fields. A city covers all 3 ports
//! of a side. Rotating a tile clockwise by r quarter turns maps port p -> (p+3r)%12.
//! Ports 3s+k on one tile meet ports 3(s+2)%4 + (2-k) on the neighbour across side s.

const std = @import("std");

pub const PortMask = u12;

pub const FeatureKind = enum(u8) { road, city, field, cloister, garden, river };

pub const Feature = struct {
    kind: FeatureKind,
    /// Edge ports this feature touches (empty for cloister/garden).
    ports: PortMask = 0,
    /// City only: number of pennants (coat of arms) on this tile's part of the city.
    pennants: u8 = 0,
    /// Field only: indices (into the same tile's `features`) of city features this
    /// field segment borders. Used for farmer scoring.
    adjacent_cities: []const u8 = &.{},
};

pub const Side = enum(u2) { n = 0, e = 1, s = 2, w = 3 };
pub const EdgeKind = enum(u8) { field, road, city, river };

pub const TileDef = struct {
    /// Stable id, e.g. "A".."X" for base tiles, "R1".."R12" for river tiles.
    id: []const u8,
    /// How many copies are in the box.
    count: u8,
    features: []const Feature,
    /// Which set this tile belongs to.
    set: enum(u8) { base, river } = .base,
    /// Start tile (darker back) / river spring / river lake markers.
    special: enum(u8) { none, start, spring, lake } = .none,

    pub fn edgeKind(self: TileDef, side: Side) EdgeKind {
        const s: u4 = @intFromEnum(side);
        const mid: PortMask = @as(PortMask, 1) << (s * 3 + 1);
        for (self.features) |f| {
            if (f.ports & mid == 0) continue;
            return switch (f.kind) {
                .city => .city,
                .road => .road,
                .river => .river,
                else => .field,
            };
        }
        return .field;
    }
};

pub fn rotatePorts(mask: PortMask, quarter_turns: u2) PortMask {
    const r: u4 = @as(u4, quarter_turns) * 3;
    if (r == 0) return mask;
    return (mask << r) | (mask >> @intCast(12 - @as(u5, r)));
}

/// Port on the neighbouring tile that touches `port` across the shared edge.
pub fn opposingPort(port: u4) u4 {
    const side: u4 = port / 3;
    const k: u4 = port % 3;
    return ((side + 2) % 4) * 3 + (2 - k);
}

test "rotate and oppose" {
    try std.testing.expectEqual(@as(PortMask, 0b1000), rotatePorts(0b1, 1));
    try std.testing.expectEqual(@as(PortMask, 0b1), rotatePorts(0b1 << 9, 1));
    try std.testing.expectEqual(@as(u4, 8), opposingPort(0));
    try std.testing.expectEqual(@as(u4, 7), opposingPort(1));
    try std.testing.expectEqual(@as(u4, 11), opposingPort(3));
}
