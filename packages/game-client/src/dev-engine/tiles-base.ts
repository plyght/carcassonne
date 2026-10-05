// TEMPORARY dev tile table for the TS reference engine. The authoritative table is
// owned by the engine workstream (`packages/core/src/engine/tiles_base.zig`).
// Uses the contract port model (see ../tiles.ts) and community letter naming.
//
// Ports: N 0,1,2 | E 3,4,5 | S 6,7,8 | W 9,10,11 (clockwise from the NW corner).
// Gardens (Abbot) and River tiles are not modelled here.

import { createCatalog, portsOf as p, sidePorts as s, type TileDef, type TileFeature } from "../tiles";

const city = (ports: number, pennants = 0): TileFeature => ({ kind: "city", ports, pennants });
const road = (...ports: number[]): TileFeature => ({ kind: "road", ports: p(...ports) });
const field = (ports: number, adjacentCities: number[] = []): TileFeature => ({
  kind: "field",
  ports,
  adjacentCities,
});
const cloister: TileFeature = { kind: "cloister", ports: 0 };

const ALL = 0xfff;

function t(id: string, count: number, features: TileFeature[], special: TileDef["special"] = "none"): TileDef {
  return { id, count, features, set: "base", special };
}

export const BASE_TILES: TileDef[] = [
  t("A", 2, [cloister, road(7), field(ALL & ~p(7))]),
  t("B", 4, [cloister, field(ALL)]),
  t("C", 1, [city(ALL, 1)]),
  // D: city cap north, straight road east-west. One copy is the start tile.
  t("D", 4, [city(s(0)), road(4, 10), field(p(3, 11), [0]), field(p(5, 6, 7, 8, 9))], "start"),
  t("E", 5, [city(s(0)), field(s(1, 2, 3), [0])]),
  t("F", 2, [city(s(1, 3), 1), field(s(0), [0]), field(s(2), [0])]),
  t("G", 1, [city(s(0, 2)), field(s(1), [0]), field(s(3), [0])]),
  t("H", 3, [city(s(1)), city(s(3)), field(s(0, 2), [0, 1])]),
  t("I", 2, [city(s(0)), city(s(1)), field(s(2, 3), [0, 1])]),
  t("J", 3, [city(s(0)), road(4, 7), field(p(5, 6)), field(p(3, 8, 9, 10, 11), [0])]),
  t("K", 3, [city(s(0)), road(7, 10), field(p(8, 9)), field(p(3, 4, 5, 6, 11), [0])]),
  t("L", 3, [
    city(s(0)),
    road(4),
    road(7),
    road(10),
    field(p(3, 11), [0]),
    field(p(5, 6)),
    field(p(8, 9)),
  ]),
  t("M", 2, [city(s(0, 3), 1), field(s(1, 2), [0])]),
  t("N", 3, [city(s(0, 3)), field(s(1, 2), [0])]),
  t("O", 2, [city(s(0, 3), 1), road(4, 7), field(p(5, 6)), field(p(3, 8), [0])]),
  t("P", 3, [city(s(0, 3)), road(4, 7), field(p(5, 6)), field(p(3, 8), [0])]),
  t("Q", 1, [city(s(0, 1, 3), 1), field(s(2), [0])]),
  t("R", 3, [city(s(0, 1, 3)), field(s(2), [0])]),
  t("S", 2, [city(s(0, 1, 3), 1), road(7), field(p(6), [0]), field(p(8), [0])]),
  t("T", 1, [city(s(0, 1, 3)), road(7), field(p(6), [0]), field(p(8), [0])]),
  t("U", 8, [road(1, 7), field(p(2, 3, 4, 5, 6)), field(p(8, 9, 10, 11, 0))]),
  t("V", 9, [road(7, 10), field(p(8, 9)), field(p(0, 1, 2, 3, 4, 5, 6, 11))]),
  t("W", 4, [road(4), road(7), road(10), field(p(11, 0, 1, 2, 3)), field(p(5, 6)), field(p(8, 9))]),
  t("X", 1, [road(1), road(4), road(7), road(10), field(p(2, 3)), field(p(5, 6)), field(p(8, 9)), field(p(11, 0))]),
];

export const START_TILE = "D";

export const baseCatalog = createCatalog(BASE_TILES);
