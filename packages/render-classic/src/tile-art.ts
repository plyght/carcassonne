// What the Classic/Blueprint renderers need to draw a tile, independent of where
// the geometry comes from. Today: ./procedural-art.ts. Later: core-geo's 2D paths
// (PRD §6.3 "Shared geometry") behind the same interface.

import type { FeatureKind, TileId } from "@carcassonne/protocol";
import type { TileDef } from "@carcassonne/game-client";

export type Pt = readonly [number, number];

/** One feature of a tile, in canonical orientation, in a 100×100 tile box. */
export interface TileArtFeature {
  /** Local feature index (TileDef.features). */
  index: number;
  kind: FeatureKind;
  /** Filled region (city, field, cloister footprint) as an SVG path. */
  area?: string;
  /** Centre line (road, river) as an SVG path. */
  line?: string;
  /** Inner boundary (city walls) as an SVG path. */
  walls?: string;
  /** Where a figure stands on this feature. */
  anchor: Pt;
  /** Pennant (coat of arms) positions. */
  pennants: Pt[];
}

export interface TileArt {
  id: TileId;
  features: TileArtFeature[];
  /** Small houses where several roads end. */
  villages: Pt[];
}

export interface TileArtSource {
  readonly name: string;
  get(def: TileDef): TileArt;
}

export const TILE = 100;

/** Rotate a canonical tile-space point clockwise by `rot` quarter turns. */
export function rotatePoint([x, y]: Pt, rot: number): [number, number] {
  switch (((rot % 4) + 4) % 4) {
    case 1:
      return [TILE - y, x];
    case 2:
      return [TILE - x, TILE - y];
    case 3:
      return [y, TILE - x];
    default:
      return [x, y];
  }
}
