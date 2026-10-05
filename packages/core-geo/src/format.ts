// Constants of the CGEO binary format. Mirrors packages/core/src/geo/README.md.

export const MAGIC = 0x4f454743; // "CGEO"
export const VERSION = 1;
export const KIND_2D = 1;
export const KIND_3D = 2;
export const KIND_FIGURE = 3;

/** Section tag as the little-endian u32 of 4 ASCII chars. */
export function tag(s: string): number {
  return (s.charCodeAt(0) | (s.charCodeAt(1) << 8) | (s.charCodeAt(2) << 16) | (s.charCodeAt(3) << 24)) >>> 0;
}

export const TAG = {
  META: tag("META"),
  FEAT: tag("FEAT"),
  PATH: tag("PATH"),
  PNTS: tag("PNTS"),
  PENN: tag("PENN"),
  VPOS: tag("VPOS"),
  VNRM: tag("VNRM"),
  VUV0: tag("VUV0"),
  VFEA: tag("VFEA"),
  INDX: tag("INDX"),
  GRUP: tag("GRUP"),
  PROP: tag("PROP"),
  ANC3: tag("ANC3"),
  SLAB: tag("SLAB"),
  FDIM: tag("FDIM"),
  OUTL: tag("OUTL"),
} as const;

/** `engine/tile.zig` FeatureKind order. */
export const FEATURE_KINDS = ["road", "city", "field", "cloister", "garden", "river"] as const;
export type GeoFeatureKind = (typeof FEATURE_KINDS)[number];

/** No feature (e.g. a junction plaza seen by the terrain classifier outside any road). */
export const NO_FEATURE = 255;

export const PATH_ROLES = {
  0: "region",
  1: "centerline",
  2: "wall",
  3: "building",
  5: "plaza",
} as const;
export type PathRole = (typeof PATH_ROLES)[keyof typeof PATH_ROLES];

export const MATERIALS = ["terrain", "wall", "water", "slab"] as const;
export type GeoMaterial = (typeof MATERIALS)[number];

export const PROPS = [
  "tower",
  "house",
  "chapel",
  "tree",
  "sheep",
  "cow",
  "cart",
  "mill",
  "fountain",
  "crop",
  "duck",
  "bridge",
  "bush",
  "gatehouse",
  "round_tower",
  "wall_stairs",
] as const;
export type PropKind = (typeof PROPS)[number];

export const TILE_SPECIAL = ["none", "start", "spring", "lake"] as const;
export const TILE_SET = ["base", "river"] as const;

/** Figure pose at an anchor. Farmers lie on their back (3rd edition). */
export const POSES = ["standing", "lying"] as const;
export type FigurePose = (typeof POSES)[number];

export const FIGURE_KINDS = ["meeple", "abbot"] as const;
export type FigureShape = (typeof FIGURE_KINDS)[number];
