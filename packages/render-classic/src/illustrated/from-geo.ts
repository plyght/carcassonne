import type { GeoProp, GeoTile2D } from "@carcassonne/core-geo";

import { hashString } from "./noise";
import type { IllustratedTile } from "./types";

/** Painter input from core-geo's 2D buffer and its 3D prop instances (projected top-down: x, z). */
export function illustratedFromGeo(g: GeoTile2D, props: readonly GeoProp[]): IllustratedTile {
  return {
    id: g.meta.id,
    seed: hashString(g.meta.id),
    special: g.meta.special,
    features: g.features.map((f) => f.kind),
    paths: g.paths.map((p) => ({
      role: p.role,
      kind: p.kind,
      feature: p.feature === 255 ? null : p.feature,
      closed: p.closed,
      width: p.width,
      pts: Array.from(p.points),
    })),
    props: props.map((p) => ({
      prop: p.prop,
      feature: p.feature,
      variant: p.variant,
      tint: p.tint,
      x: p.position[0],
      y: p.position[2],
      yaw: p.yaw,
      scale: p.scale,
      height: p.height,
    })),
    pennants: g.pennants.map((p) => ({ feature: p.feature, x: p.x, y: p.y })),
  };
}
