//! The River (River I, 3rd edition art): 12 tiles, R1 = spring, R12 = lake.
//!
//! Sources:
//! - WikiCarpedia "River", section "The River I C3" tile list and setup rules,
//!   https://wikicarpedia.com/car/River (fetched 2026-10 via ?action=raw).
//!   Edge layouts were read from River_I_C3_Tile_A.png .. _L.png on that page.
//!   R1..R12 map to the wiki's C3 letters A..L in order.
//! - WikiCarpedia "The Abbot": the River I tile J (here R10) carries a garden.
//! - The C3 lake (L) shows a cloister; the spring (A) has a road crossing near it.
//!   "The field space on the lake and source tiles wraps around those features"
//!   (RGG Big Box rules, quoted on the River page), so the spring and lake have a
//!   single field around the river end.
//!
//! Port reference (tile.zig): N = 0,1,2, E = 3,4,5, S = 6,7,8, W = 9,10,11.
const tile = @import("tile.zig");
const k = @import("tilekit.zig");

const TileDef = tile.TileDef;
const city = k.city;
const road = k.road;
const river = k.river;
const field = k.field;

const r1 = [_]k.Feature{ river(&.{7}), road(&.{ 1, 4 }), field(&.{ 2, 3 }, &.{}), field(&.{ 0, 5, 6, 8, 9, 10, 11 }, &.{}) };
const r2 = [_]k.Feature{
    city(k.N, 0), river(&.{ 4, 10 }), road(&.{7}),
    field(&.{11}, &.{0}), field(&.{3}, &.{0}), field(&.{ 8, 9 }, &.{}), field(&.{ 5, 6 }, &.{}),
};
const r3 = [_]k.Feature{ city(k.N, 0), city(k.S, 0), river(&.{ 4, 10 }), field(&.{ 11, 3 }, &.{0}), field(&.{ 9, 5 }, &.{1}) };
const r4 = [_]k.Feature{ river(&.{ 1, 7 }), field(&.{ 8, 9, 10, 11, 0 }, &.{}), field(&.{ 2, 3, 4, 5, 6 }, &.{}) };
const r5 = [_]k.Feature{ city(k.N | k.E, 0), river(&.{ 10, 7 }), field(&.{ 8, 9 }, &.{}), field(&.{ 11, 6 }, &.{0}) };
const r6 = r4;
const r7 = [_]k.Feature{ river(&.{ 1, 10 }), field(&.{ 11, 0 }, &.{}), field(&.{ 2, 3, 4, 5, 6, 7, 8, 9 }, &.{}) };
const r8 = [_]k.Feature{
    k.cloister,                         river(&.{ 4, 10 }), road(&.{7}),
    field(&.{ 11, 0, 1, 2, 3 }, &.{}), field(&.{ 8, 9 }, &.{}), field(&.{ 5, 6 }, &.{}),
};
const r9 = [_]k.Feature{
    road(&.{ 1, 10 }), river(&.{ 4, 7 }),
    field(&.{ 11, 0 }, &.{}), field(&.{ 2, 3, 8, 9 }, &.{}), field(&.{ 5, 6 }, &.{}),
};
const r10 = [_]k.Feature{ river(&.{ 4, 7 }), field(&.{ 5, 6 }, &.{}), field(&.{ 8, 9, 10, 11, 0, 1, 2, 3 }, &.{}), k.garden };
const r11 = [_]k.Feature{
    river(&.{ 1, 7 }),        road(&.{ 4, 10 }),
    field(&.{ 11, 0 }, &.{}), field(&.{ 2, 3 }, &.{}), field(&.{ 5, 6 }, &.{}), field(&.{ 8, 9 }, &.{}),
};
const r12 = [_]k.Feature{ river(&.{1}), k.cloister, field(&.{ 0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11 }, &.{}) };

pub const tiles = [_]TileDef{
    .{ .id = "R1", .count = 1, .features = &r1, .set = .river, .special = .spring }, // spring, road N-E
    .{ .id = "R2", .count = 1, .features = &r2, .set = .river }, // city N, road from city over a bridge
    .{ .id = "R3", .count = 1, .features = &r3, .set = .river }, // cities N and S
    .{ .id = "R4", .count = 1, .features = &r4, .set = .river }, // straight
    .{ .id = "R5", .count = 1, .features = &r5, .set = .river }, // city N+E, river bend W-S
    .{ .id = "R6", .count = 1, .features = &r6, .set = .river }, // straight (meander)
    .{ .id = "R7", .count = 1, .features = &r7, .set = .river }, // bend N-W
    .{ .id = "R8", .count = 1, .features = &r8, .set = .river }, // cloister, road over a bridge
    .{ .id = "R9", .count = 1, .features = &r9, .set = .river }, // road bend N-W, river bend E-S
    .{ .id = "R10", .count = 1, .features = &r10, .set = .river }, // bend E-S, garden
    .{ .id = "R11", .count = 1, .features = &r11, .set = .river }, // straight, road crossing
    .{ .id = "R12", .count = 1, .features = &r12, .set = .river, .special = .lake }, // lake with cloister
};
