// Input of the tile painter: core-geo's 2D paths plus its 3D prop instances projected
// top-down, in canonical orientation and unit tile space (0..1, y down). Built by
// geo-art.ts; pure data, so it can also be serialised for dev pages.

import type { FeatureKind } from "@carcassonne/protocol";

export interface IllPath {
  role: "region" | "centerline" | "wall" | "building" | "plaza";
  kind: FeatureKind;
  /** Local feature index, or null. */
  feature: number | null;
  closed: boolean;
  /** Suggested stroke width (tile units, 0..1). */
  width: number;
  /** Interleaved x, y in 0..1. */
  pts: number[];
}

export interface IllProp {
  /** core-geo PropKind ("house", "tower", "tree", …). */
  prop: string;
  feature: number;
  variant: number;
  tint: number;
  /** Ground position, 0..1 (geo x and z). */
  x: number;
  y: number;
  /** Radians about +y (geo convention: 0 faces +z). */
  yaw: number;
  scale: number;
  height: number;
}

export interface IllustratedTile {
  id: string;
  /** Hash of the id: seeds per-tile variation. */
  seed: number;
  special: "none" | "start" | "spring" | "lake";
  /** Kind of each local feature (TileDef.features order). */
  features: FeatureKind[];
  paths: IllPath[];
  props: IllProp[];
  pennants: { feature: number; x: number; y: number }[];
}

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

/** A 2D canvas (DOM canvas when available, so toBlob/drawImage work everywhere). */
export function makeCanvas(w: number, h: number): AnyCanvas {
  if (typeof document !== "undefined") {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  throw new Error("no canvas available");
}

export function canPaint(): boolean {
  return typeof document !== "undefined" || typeof OffscreenCanvas !== "undefined";
}

export function ctx2d(c: AnyCanvas): Ctx2D {
  const ctx = c.getContext("2d") as Ctx2D | null;
  if (!ctx) throw new Error("2d context unavailable");
  return ctx;
}
