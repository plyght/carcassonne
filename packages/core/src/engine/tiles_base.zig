//! Base game tiles: 24 types, 72 tiles, 10 pennants (coats of arms).
//!
//! Sources:
//! - WikiCarpedia "Base game", section "Tile distribution" (C3 / 3rd edition art),
//!   https://wikicarpedia.com/car/Base_game (fetched 2026-10 via ?action=raw), which
//!   uses the standard community letters A..X with counts
//!   A2 B4 C1 D4 E5 F2 G1 H3 I2 J3 K3 L3 M2 N3 O2 P3 Q1 R3 S2 T1 U8 V9 W4 X1.
//!   Edge layouts were read from the C3 tile images on that page
//!   (Base_Game_C3_Tile_A.png .. _X.png).
//! - WikiCarpedia "The Abbot", section "Tile distribution",
//!   https://wikicarpedia.com/car/The_Abbot: exactly one copy each of
//!   E, H, I, M, N, R, U and V shows a garden (8 base tiles), matching the
//!   "Garden" entries in the C3 base game tile list.
//!
//! Canonical orientation (rot 0) follows the wiki images. Garden copies get their
//! own tile id with a "g" suffix ("Eg", "Hg", ...): the garden is an extra feature
//! appended after the plain tile's features, so feature indices are shared with
//! the plain tile. A garden is not connected to anything (no ports), so its exact
//! position inside the field does not matter to the rules; see RULES_NOTES.md.
//!
//! Port reference (tile.zig): N = 0,1,2 (W->E), E = 3,4,5 (N->S),
//! S = 6,7,8 (E->W), W = 9,10,11 (S->N). Middle ports 1,4,7,10 carry roads.
const tile = @import("tile.zig");
const k = @import("tilekit.zig");

const TileDef = tile.TileDef;
const city = k.city;
const road = k.road;
const field = k.field;

const a_f = [_]k.Feature{ k.cloister, road(&.{7}), field(&.{ 0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11 }, &.{}) };
const b_f = [_]k.Feature{ k.cloister, k.fieldMask(k.ALL, &.{}) };
const c_f = [_]k.Feature{city(k.ALL, 1)};
const d_f = [_]k.Feature{ city(k.N, 0), road(&.{ 4, 10 }), field(&.{ 3, 11 }, &.{0}), field(&.{ 5, 6, 7, 8, 9 }, &.{}) };
const e_f = [_]k.Feature{ city(k.N, 0), field(&.{ 3, 4, 5, 6, 7, 8, 9, 10, 11 }, &.{0}) };
const f_f = [_]k.Feature{ city(k.E | k.W, 1), field(&.{ 0, 1, 2 }, &.{0}), field(&.{ 6, 7, 8 }, &.{0}) };
const g_f = [_]k.Feature{ city(k.E | k.W, 0), field(&.{ 0, 1, 2 }, &.{0}), field(&.{ 6, 7, 8 }, &.{0}) };
const h_f = [_]k.Feature{ city(k.N, 0), city(k.S, 0), field(&.{ 3, 4, 5, 9, 10, 11 }, &.{ 0, 1 }) };
const i_f = [_]k.Feature{ city(k.N, 0), city(k.W, 0), field(&.{ 3, 4, 5, 6, 7, 8 }, &.{ 0, 1 }) };
const j_f = [_]k.Feature{ city(k.N, 0), road(&.{ 4, 7 }), field(&.{ 3, 8, 9, 10, 11 }, &.{0}), field(&.{ 5, 6 }, &.{}) };
const k_f = [_]k.Feature{ city(k.N, 0), road(&.{ 10, 7 }), field(&.{ 3, 4, 5, 6, 11 }, &.{0}), field(&.{ 8, 9 }, &.{}) };
const l_f = [_]k.Feature{
    city(k.N, 0),          road(&.{4}),             road(&.{7}),              road(&.{10}),
    field(&.{ 3, 11 }, &.{0}), field(&.{ 5, 6 }, &.{}), field(&.{ 8, 9 }, &.{}),
};
const m_f = [_]k.Feature{ city(k.N | k.W, 1), field(&.{ 3, 4, 5, 6, 7, 8 }, &.{0}) };
const n_f = [_]k.Feature{ city(k.N | k.W, 0), field(&.{ 3, 4, 5, 6, 7, 8 }, &.{0}) };
const o_f = [_]k.Feature{ city(k.N | k.W, 1), road(&.{ 4, 7 }), field(&.{ 3, 8 }, &.{0}), field(&.{ 5, 6 }, &.{}) };
const p_f = [_]k.Feature{ city(k.N | k.W, 0), road(&.{ 4, 7 }), field(&.{ 3, 8 }, &.{0}), field(&.{ 5, 6 }, &.{}) };
const q_f = [_]k.Feature{ city(k.N | k.E | k.W, 1), field(&.{ 6, 7, 8 }, &.{0}) };
const r_f = [_]k.Feature{ city(k.N | k.E | k.W, 0), field(&.{ 6, 7, 8 }, &.{0}) };
const s_f = [_]k.Feature{ city(k.N | k.E | k.W, 1), road(&.{7}), field(&.{6}, &.{0}), field(&.{8}, &.{0}) };
const t_f = [_]k.Feature{ city(k.N | k.E | k.W, 0), road(&.{7}), field(&.{6}, &.{0}), field(&.{8}, &.{0}) };
const u_f = [_]k.Feature{ road(&.{ 1, 7 }), field(&.{ 8, 9, 10, 11, 0 }, &.{}), field(&.{ 2, 3, 4, 5, 6 }, &.{}) };
const v_f = [_]k.Feature{ road(&.{ 10, 7 }), field(&.{ 8, 9 }, &.{}), field(&.{ 11, 0, 1, 2, 3, 4, 5, 6 }, &.{}) };
const w_f = [_]k.Feature{
    road(&.{4}),                       road(&.{7}),              road(&.{10}),
    field(&.{ 11, 0, 1, 2, 3 }, &.{}), field(&.{ 5, 6 }, &.{}), field(&.{ 8, 9 }, &.{}),
};
const x_f = [_]k.Feature{
    road(&.{1}),               road(&.{4}),              road(&.{7}),              road(&.{10}),
    field(&.{ 11, 0 }, &.{}), field(&.{ 2, 3 }, &.{}), field(&.{ 5, 6 }, &.{}), field(&.{ 8, 9 }, &.{}),
};

/// All base tiles. Order is stable and used as the engine's tile index.
pub const tiles = [_]TileDef{
    .{ .id = "A", .count = 2, .features = &a_f }, // cloister with road
    .{ .id = "B", .count = 4, .features = &b_f }, // cloister
    .{ .id = "C", .count = 1, .features = &c_f }, // full city, pennant
    .{ .id = "D", .count = 4, .features = &d_f, .special = .start }, // city N, straight road (start tile is one of the 4)
    .{ .id = "E", .count = 4, .features = &e_f }, // city N (+1 garden copy below)
    .{ .id = "F", .count = 2, .features = &f_f }, // city E-W, pennant
    .{ .id = "G", .count = 1, .features = &g_f }, // city E-W
    .{ .id = "H", .count = 2, .features = &h_f }, // cities N and S, separate (+1 garden)
    .{ .id = "I", .count = 1, .features = &i_f }, // cities N and W, separate (+1 garden)
    .{ .id = "J", .count = 3, .features = &j_f }, // city N, road E-S
    .{ .id = "K", .count = 3, .features = &k_f }, // city N, road W-S
    .{ .id = "L", .count = 3, .features = &l_f }, // city N, three roads to a village
    .{ .id = "M", .count = 1, .features = &m_f }, // city N+W, pennant (+1 garden)
    .{ .id = "N", .count = 2, .features = &n_f }, // city N+W (+1 garden)
    .{ .id = "O", .count = 2, .features = &o_f }, // city N+W, pennant, road E-S
    .{ .id = "P", .count = 3, .features = &p_f }, // city N+W, road E-S
    .{ .id = "Q", .count = 1, .features = &q_f }, // city N+E+W, pennant
    .{ .id = "R", .count = 2, .features = &r_f }, // city N+E+W (+1 garden)
    .{ .id = "S", .count = 2, .features = &s_f }, // city N+E+W, pennant, road S
    .{ .id = "T", .count = 1, .features = &t_f }, // city N+E+W, road S
    .{ .id = "U", .count = 7, .features = &u_f }, // straight road N-S (+1 garden)
    .{ .id = "V", .count = 8, .features = &v_f }, // curved road W-S (+1 garden)
    .{ .id = "W", .count = 4, .features = &w_f }, // three roads to a village
    .{ .id = "X", .count = 1, .features = &x_f }, // crossroads
    // 3rd edition garden copies (The Abbot).
    .{ .id = "Eg", .count = 1, .features = k.withGarden(&e_f) },
    .{ .id = "Hg", .count = 1, .features = k.withGarden(&h_f) },
    .{ .id = "Ig", .count = 1, .features = k.withGarden(&i_f) },
    .{ .id = "Mg", .count = 1, .features = k.withGarden(&m_f) },
    .{ .id = "Ng", .count = 1, .features = k.withGarden(&n_f) },
    .{ .id = "Rg", .count = 1, .features = k.withGarden(&r_f) },
    .{ .id = "Ug", .count = 1, .features = k.withGarden(&u_f) },
    .{ .id = "Vg", .count = 1, .features = k.withGarden(&v_f) },
};

/// The letter type of a tile id ("Eg" -> 'E').
pub fn letter(id: []const u8) u8 {
    return id[0];
}
