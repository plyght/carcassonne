//! Geo-owned fixture TileDefs covering every topology the renderer must
//! handle. They follow the shared schema in engine/tile.zig exactly, so the
//! engine's real tables (tiles_base.zig / tiles_river.zig) can replace them
//! through geo/registry.zig without touching any geo code.
//!
//! Port numbering (clockwise from the NW corner):
//!        0  1  2
//!     11 +-----+ 3
//!     10 |     | 4
//!      9 +-----+ 5
//!        8  7  6

const tile = @import("../engine/tile.zig");
const TileDef = tile.TileDef;
const Feature = tile.Feature;
const PortMask = tile.PortMask;

fn pm(comptime ports: []const u4) PortMask {
    var m: PortMask = 0;
    for (ports) |p| m |= @as(PortMask, 1) << p;
    return m;
}

const N: PortMask = pm(&.{ 0, 1, 2 });
const E: PortMask = pm(&.{ 3, 4, 5 });
const S: PortMask = pm(&.{ 6, 7, 8 });
const W: PortMask = pm(&.{ 9, 10, 11 });

fn city(ports: PortMask, pennants: u8) Feature {
    return .{ .kind = .city, .ports = ports, .pennants = pennants };
}
fn field(ports: PortMask, adj: []const u8) Feature {
    return .{ .kind = .field, .ports = ports, .adjacent_cities = adj };
}
fn road(ports: PortMask) Feature {
    return .{ .kind = .road, .ports = ports };
}
fn river(ports: PortMask) Feature {
    return .{ .kind = .river, .ports = ports };
}
const cloister: Feature = .{ .kind = .cloister };
const garden: Feature = .{ .kind = .garden };

pub const all = [_]TileDef{
    // --- cities ---------------------------------------------------------------
    .{ .id = "fx-city4", .count = 1, .features = &.{city(N | E | S | W, 1)} },
    .{ .id = "fx-cap", .count = 1, .features = &.{ city(N, 0), field(E | S | W, &.{0}) } },
    .{ .id = "fx-caps-opposite", .count = 1, .features = &.{ city(N, 0), city(S, 0), field(E | W, &.{ 0, 1 }) } },
    .{ .id = "fx-caps-adjacent", .count = 1, .features = &.{ city(N, 0), city(W, 0), field(E | S, &.{ 0, 1 }) } },
    .{ .id = "fx-corner-pennant", .count = 1, .features = &.{ city(N | W, 1), field(E | S, &.{0}) } },
    .{ .id = "fx-corner-road", .count = 1, .features = &.{
        city(N | W, 0),
        road(pm(&.{ 4, 7 })),
        field(pm(&.{ 3, 8 }), &.{0}),
        field(pm(&.{ 5, 6 }), &.{}),
    } },
    .{ .id = "fx-city-band", .count = 1, .features = &.{ city(N | S, 1), field(E, &.{0}), field(W, &.{0}) } },
    .{ .id = "fx-city3", .count = 1, .features = &.{ city(N | E | W, 0), field(S, &.{0}) } },
    .{ .id = "fx-city3-road", .count = 1, .features = &.{
        city(N | E | W, 1),
        road(pm(&.{7})),
        field(pm(&.{6}), &.{0}),
        field(pm(&.{8}), &.{0}),
    } },
    .{ .id = "fx-cap-road-straight", .count = 1, .features = &.{
        city(N, 0),
        road(pm(&.{ 4, 10 })),
        field(pm(&.{ 3, 11 }), &.{0}),
        field(pm(&.{ 5, 6, 7, 8, 9 }), &.{}),
    } },
    .{ .id = "fx-cap-road-curve", .count = 1, .features = &.{
        city(N, 0),
        road(pm(&.{ 10, 7 })),
        field(pm(&.{ 11, 3, 4, 5, 6 }), &.{0}),
        field(pm(&.{ 8, 9 }), &.{}),
    } },
    .{ .id = "fx-cap-crossroads", .count = 1, .features = &.{
        city(N, 0),
        road(pm(&.{4})),
        road(pm(&.{7})),
        road(pm(&.{10})),
        field(pm(&.{ 3, 11 }), &.{0}),
        field(pm(&.{ 5, 6 }), &.{}),
        field(pm(&.{ 8, 9 }), &.{}),
    } },
    // --- roads ----------------------------------------------------------------
    .{ .id = "fx-road-straight", .count = 1, .features = &.{
        road(pm(&.{ 1, 7 })),
        field(pm(&.{ 2, 3, 4, 5, 6 }), &.{}),
        field(pm(&.{ 8, 9, 10, 11, 0 }), &.{}),
    } },
    .{ .id = "fx-road-curve", .count = 1, .features = &.{
        road(pm(&.{ 10, 7 })),
        field(pm(&.{ 8, 9 }), &.{}),
        field(pm(&.{ 11, 0, 1, 2, 3, 4, 5, 6 }), &.{}),
    } },
    .{ .id = "fx-crossroads3", .count = 1, .features = &.{
        road(pm(&.{4})),
        road(pm(&.{7})),
        road(pm(&.{10})),
        field(pm(&.{ 11, 0, 1, 2, 3 }), &.{}),
        field(pm(&.{ 5, 6 }), &.{}),
        field(pm(&.{ 8, 9 }), &.{}),
    } },
    .{ .id = "fx-crossroads4", .count = 1, .features = &.{
        road(pm(&.{1})),
        road(pm(&.{4})),
        road(pm(&.{7})),
        road(pm(&.{10})),
        field(pm(&.{ 2, 3 }), &.{}),
        field(pm(&.{ 5, 6 }), &.{}),
        field(pm(&.{ 8, 9 }), &.{}),
        field(pm(&.{ 11, 0 }), &.{}),
    } },
    // --- cloisters / gardens --------------------------------------------------
    .{ .id = "fx-cloister", .count = 1, .features = &.{ cloister, field(N | E | S | W, &.{}) } },
    .{ .id = "fx-cloister-road", .count = 1, .features = &.{
        cloister,
        road(pm(&.{7})),
        field(N | E | W | pm(&.{ 6, 8 }), &.{}),
    } },
    .{ .id = "fx-garden-road", .count = 1, .features = &.{
        road(pm(&.{ 10, 7 })),
        field(pm(&.{ 8, 9 }), &.{}),
        field(pm(&.{ 11, 0, 1, 2, 3, 4, 5, 6 }), &.{}),
        garden,
    } },
    .{ .id = "fx-garden-cap", .count = 1, .features = &.{ city(N, 0), field(E | S | W, &.{0}), garden } },
    // --- river ----------------------------------------------------------------
    .{ .id = "fx-river-spring", .count = 1, .set = .river, .special = .spring, .features = &.{
        river(pm(&.{7})),
        field(N | E | W | pm(&.{ 6, 8 }), &.{}),
    } },
    .{ .id = "fx-river-lake", .count = 1, .set = .river, .special = .lake, .features = &.{
        river(pm(&.{1})),
        field(E | S | W | pm(&.{ 0, 2 }), &.{}),
    } },
    .{ .id = "fx-river-straight", .count = 1, .set = .river, .features = &.{
        river(pm(&.{ 1, 7 })),
        field(pm(&.{ 2, 3, 4, 5, 6 }), &.{}),
        field(pm(&.{ 8, 9, 10, 11, 0 }), &.{}),
    } },
    .{ .id = "fx-river-curve", .count = 1, .set = .river, .features = &.{
        river(pm(&.{ 10, 7 })),
        field(pm(&.{ 8, 9 }), &.{}),
        field(pm(&.{ 11, 0, 1, 2, 3, 4, 5, 6 }), &.{}),
    } },
    .{ .id = "fx-river-bridge", .count = 1, .set = .river, .features = &.{
        river(pm(&.{ 1, 7 })),
        road(pm(&.{ 4, 10 })),
        field(pm(&.{ 2, 3 }), &.{}),
        field(pm(&.{ 5, 6 }), &.{}),
        field(pm(&.{ 8, 9 }), &.{}),
        field(pm(&.{ 11, 0 }), &.{}),
    } },
    .{ .id = "fx-river-city", .count = 1, .set = .river, .features = &.{
        city(N, 1),
        river(pm(&.{ 4, 10 })),
        field(pm(&.{ 3, 11 }), &.{0}),
        field(pm(&.{ 5, 6, 7, 8, 9 }), &.{}),
    } },
    .{ .id = "fx-river-cloister", .count = 1, .set = .river, .features = &.{
        river(pm(&.{ 1, 4 })),
        cloister,
        road(pm(&.{7})),
        field(pm(&.{ 2, 3 }), &.{}),
        field(pm(&.{ 5, 6, 8, 9, 10, 11, 0 }), &.{}),
    } },
};
