// Tile and figure art from the Zig core's procedural geometry (core/geo, decoded by
// @carcassonne/core-geo). This is the real art source (PRD §6.3 "Shared geometry"):
// the same 2D regions desktop draws with zpui paths. Styles only change colours.

import type { FigureKind } from "@carcassonne/protocol";
import type { CoreGeo, GeoTile2D } from "@carcassonne/core-geo";
import type { TileDef } from "@carcassonne/game-client";

import type { FigureArtSource } from "./figures";
import { illustratedFromGeo } from "./illustrated/from-geo";
import type { IllustratedTile } from "./illustrated/types";
import { TILE, type Pt, type TileArt, type TileArtFeature, type TileArtLayer, type TileArtSource } from "./tile-art";

const fmt = (n: number) => (Math.round(n * 100) / 100).toString();

/** SVG path data for interleaved 0..1 points, scaled to the 100-unit tile box. */
function pathData(points: Float32Array, closed: boolean, scale = TILE, dx = 0, dy = 0): string {
  let d = "";
  for (let i = 0; i + 1 < points.length; i += 2) {
    d += `${i ? "L" : "M"}${fmt(points[i]! * scale + dx)} ${fmt(points[i + 1]! * scale + dy)}`;
  }
  return closed ? `${d}Z` : d;
}

function centroid(points: Float32Array): Pt {
  let x = 0;
  let y = 0;
  const n = points.length / 2;
  for (let i = 0; i + 1 < points.length; i += 2) {
    x += points[i]!;
    y += points[i + 1]!;
  }
  return [(x / n) * TILE, (y / n) * TILE];
}


/** Build TileArt from a decoded 2D geo buffer. */
export function artFromGeo(def: TileDef, g: GeoTile2D): TileArt {
  const features: TileArtFeature[] = def.features.map((f, index) => {
    const gf = g.features[index];
    return {
      index,
      kind: f.kind,
      anchor: gf ? ([gf.anchor[0] * TILE, gf.anchor[1] * TILE] as Pt) : ([50, 50] as Pt),
      pennants: [],
    };
  });
  const layers: TileArtLayer[] = [];
  const villages: Pt[] = [];
  const areas = new Map<number, string[]>();
  for (const p of g.paths) {
    const d = pathData(p.points, p.closed);
    const feature = p.feature === 255 ? null : p.feature;
    layers.push({ role: p.role, kind: p.kind, feature, d, width: p.width * TILE, center: p.role === "building" || p.role === "plaza" ? centroid(p.points) : undefined });
    const f = feature === null ? undefined : features[feature];
    if (!f) continue;
    if (p.role === "region" || p.role === "building") {
      const list = areas.get(f.index) ?? [];
      list.push(d);
      areas.set(f.index, list);
    } else if (p.role === "centerline") {
      f.line = f.line ? `${f.line}${d}` : d;
    } else if (p.role === "wall") {
      f.walls = f.walls ? `${f.walls}${d}` : d;
    }
    if (p.role === "plaza") villages.push(centroid(p.points));
  }
  for (const [i, ds] of areas) features[i]!.area = ds.join("");
  for (const pn of g.pennants) features[pn.feature]?.pennants.push([pn.x * TILE, pn.y * TILE]);
  return { id: def.id, features, villages, layers };
}

/**
 * TileArtSource backed by core.wasm geometry (cached per tile id). With `tile3d`, it
 * also feeds the painted Classic art: 2D regions plus the 3D prop instances (houses,
 * towers, trees…) projected top-down, so the 2D and 3D boards share one layout.
 */
export function createGeoArt(geo: Pick<CoreGeo, "tile2d"> & Partial<Pick<CoreGeo, "tile3d">>): TileArtSource {
  const cache = new Map<string, TileArt>();
  const painted = new Map<string, IllustratedTile | null>();
  const tile3d = geo.tile3d?.bind(geo);
  return {
    name: "core-geo",
    get(def) {
      let art = cache.get(def.id);
      if (!art) {
        art = artFromGeo(def, geo.tile2d(def.id));
        cache.set(def.id, art);
      }
      return art;
    },
    illustrated: tile3d
      ? (def) => {
          let t = painted.get(def.id);
          if (t === undefined) {
            try {
              // Props do not depend on the mesh resolution; 2 keeps the call cheap.
              t = illustratedFromGeo(geo.tile2d(def.id), tile3d(def.id, 2).props);
            } catch {
              t = null;
            }
            painted.set(def.id, t);
          }
          return t;
        }
      : undefined,
  };
}

/** FigureArtSource from core/geo's classic meeple and abbot outlines. */
export function createGeoFigures(geo: Pick<CoreGeo, "figure">): FigureArtSource {
  // Outlines are centred, height 1, y down; tokens use a 24×24 box with feet at y≈23.
  const make = (kind: FigureKind) => {
    const f = geo.figure(kind, "standing");
    return { d: pathData(f.outline, true, 22, 12, 12) };
  };
  const meeple = make("meeple");
  const abbot = make("abbot");
  return {
    name: "core-geo",
    path: (kind) => (kind === "abbot" ? abbot.d : meeple.d),
    markerAt: (kind) => (kind === "abbot" ? [12, 15.5] : [12, 13.5]),
  };
}
