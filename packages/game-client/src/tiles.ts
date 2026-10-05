// TypeScript mirror of the contract tile schema in `packages/core/src/engine/tile.zig`.
//
// Each tile edge is split into 3 "ports", numbered clockwise starting at the
// north edge's west end:
//
//        0  1  2
//     11 +-----+ 3
//     10 |     | 4
//      9 +-----+ 5
//        8  7  6
//
// Side s (N=0,E=1,S=2,W=3) owns ports 3s..3s+2. The middle port carries roads and
// rivers. Rotating a tile clockwise by r quarter turns maps port p -> (p+3r)%12.
// Port 3s+k meets port 3((s+2)%4) + (2-k) on the neighbour across side s.

import type { FeatureKind, TileId } from "@carcassonne/protocol";

export type PortMask = number; // 12 bits
export type Rot = 0 | 1 | 2 | 3;
export type Side = 0 | 1 | 2 | 3;
export type EdgeKind = "field" | "road" | "city" | "river";

export interface TileFeature {
  kind: FeatureKind;
  /** Edge ports this feature touches (0 for cloister/garden). */
  ports: PortMask;
  /** City only: pennants on this tile's part of the city. */
  pennants?: number;
  /** Field only: indices of city features on this tile that the field borders. */
  adjacentCities?: number[];
}

export interface TileDef {
  id: TileId;
  count: number;
  features: TileFeature[];
  set: "base" | "river";
  special: "none" | "start" | "spring" | "lake";
}

/** Anything that can resolve a tile id to its definition. */
export interface TileCatalog {
  get(id: TileId): TileDef | undefined;
  all(): TileDef[];
}

export const SIDE_DELTA: readonly [number, number][] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

export function portsOf(...ports: number[]): PortMask {
  let m = 0;
  for (const p of ports) m |= 1 << p;
  return m;
}

/** All three ports of the given sides. */
export function sidePorts(...sides: Side[]): PortMask {
  let m = 0;
  for (const s of sides) m |= 0b111 << (s * 3);
  return m;
}

export function rotatePorts(mask: PortMask, rot: number): PortMask {
  const r = ((rot % 4) + 4) % 4 * 3;
  if (r === 0) return mask & 0xfff;
  return ((mask << r) | (mask >>> (12 - r))) & 0xfff;
}

export function opposingPort(port: number): number {
  const side = Math.floor(port / 3);
  const k = port % 3;
  return ((side + 2) % 4) * 3 + (2 - k);
}

export function hasPort(mask: PortMask, port: number): boolean {
  return (mask & (1 << port)) !== 0;
}

export function listPorts(mask: PortMask): number[] {
  const out: number[] = [];
  for (let p = 0; p < 12; p++) if (mask & (1 << p)) out.push(p);
  return out;
}

/** Index of the feature that owns world-space `port` for a tile placed with `rot`. */
export function featureAtPort(def: TileDef, rot: number, worldPort: number): number {
  const local = (((worldPort - 3 * rot) % 12) + 12) % 12;
  return def.features.findIndex((f) => hasPort(f.ports, local));
}

/** Edge kind of world-space side `side` for a tile placed with `rot`. */
export function edgeKind(def: TileDef, rot: number, side: number): EdgeKind {
  const f = featureAtPort(def, rot, side * 3 + 1);
  if (f < 0) return "field";
  const kind = def.features[f]!.kind;
  return kind === "city" || kind === "road" || kind === "river" ? kind : "field";
}

/** Sides (canonical) whose middle port belongs to a feature. */
export function featureSides(feature: TileFeature): Side[] {
  const out: Side[] = [];
  for (let s = 0; s < 4; s++) if (hasPort(feature.ports, s * 3 + 1)) out.push(s as Side);
  return out;
}

export function createCatalog(defs: TileDef[]): TileCatalog {
  const map = new Map(defs.map((d) => [d.id, d]));
  return { get: (id) => map.get(id), all: () => defs };
}
