//! Small comptime helpers for writing tile tables (see tiles_base.zig, tiles_river.zig).
//! Port numbering is defined in tile.zig:
//!
//!        0  1  2
//!     11 +-----+ 3
//!     10 |     | 4
//!      9 +-----+ 5
//!        8  7  6
const tile = @import("tile.zig");

pub const Feature = tile.Feature;
pub const PortMask = tile.PortMask;

/// Build a port mask from a list of port numbers.
pub fn ports(comptime list: []const u4) PortMask {
    var m: PortMask = 0;
    for (list) |p| m |= @as(PortMask, 1) << p;
    return m;
}

/// Whole sides (all three ports), for cities.
pub const N: PortMask = 0b111;
pub const E: PortMask = 0b111 << 3;
pub const S: PortMask = 0b111 << 6;
pub const W: PortMask = 0b111 << 9;
pub const ALL: PortMask = 0xfff;

pub fn city(mask: PortMask, pennants: u8) Feature {
    return .{ .kind = .city, .ports = mask, .pennants = pennants };
}

pub fn road(comptime list: []const u4) Feature {
    return .{ .kind = .road, .ports = ports(list) };
}

pub fn river(comptime list: []const u4) Feature {
    return .{ .kind = .river, .ports = ports(list) };
}

pub fn field(comptime list: []const u4, comptime adj: []const u8) Feature {
    return .{ .kind = .field, .ports = ports(list), .adjacent_cities = adj };
}

pub fn fieldMask(mask: PortMask, comptime adj: []const u8) Feature {
    return .{ .kind = .field, .ports = mask, .adjacent_cities = adj };
}

pub const cloister: Feature = .{ .kind = .cloister };
pub const garden: Feature = .{ .kind = .garden };

/// Same features plus a garden appended at the end, so the local indices of
/// the original features are unchanged.
pub fn withGarden(comptime fs: []const Feature) []const Feature {
    const out = fs[0..fs.len].* ++ [_]Feature{garden};
    const frozen = out;
    return &frozen;
}
