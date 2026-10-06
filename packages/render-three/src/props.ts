// Prop models come from the shared Zig core (packages/core/src/geo/props.zig,
// via `CoreGeo.prop`), so web and desktop draw identical props. This file only
// wraps them as THREE.BufferGeometry: each model is in prop-local space (tile
// units, +y up, yaw 0 faces +z) with a per-vertex `aPart` palette slot that the
// prop material maps through the style palette (so one InstancedMesh per
// (prop, variant) draws every part in one call and a style switch only
// rewrites the palette) and a baked `aShade` factor.
import * as THREE from "three/webgpu";
import { PROP_PARTS, PROP_PART_COUNT, PROP_VARIANTS, type GeoPropModel, type PropKind } from "@carcassonne/core-geo";

/** Palette slots (`aPart`). Rows of the palette texture are the prop `tint`. */
export const PART = PROP_PARTS;
export const PART_COUNT = PROP_PART_COUNT;
export const TINT_COUNT = 4;

/** Number of distinct models per prop kind (geo `variant % count`). */
export const VARIANTS = PROP_VARIANTS;

/** What the kit needs from @carcassonne/core-geo's `CoreGeo`. */
export interface PropSource {
  prop(kind: PropKind, variant?: number, options?: { rounded?: boolean }): GeoPropModel;
}

export interface KitOptions {
  /** Rounder silhouettes (more segments, smoother foliage) for toon styles. */
  rounded: boolean;
}

/** Wraps geo prop models as geometries, cached per (prop, variant). */
export class PropKit {
  private cache = new Map<string, THREE.BufferGeometry>();
  constructor(
    private geo: PropSource,
    readonly options: KitOptions,
  ) {}

  variantOf(prop: PropKind, variant: number): number {
    return variant % VARIANTS[prop];
  }

  geometry(prop: PropKind, variant: number): THREE.BufferGeometry {
    const v = this.variantOf(prop, variant);
    const key = `${prop}:${v}`;
    let g = this.cache.get(key);
    if (!g) {
      const m = this.geo.prop(prop, v, { rounded: this.options.rounded });
      g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(m.positions.slice(), 3));
      g.setAttribute("normal", new THREE.BufferAttribute(m.normals.slice(), 3));
      g.setAttribute("aPart", new THREE.BufferAttribute(Float32Array.from(m.parts), 1));
      g.setAttribute("aShade", new THREE.BufferAttribute(m.shade.slice(), 1));
      g.setIndex(new THREE.BufferAttribute(m.indices.slice(), 1));
      g.computeBoundingSphere();
      g.computeBoundingBox();
      this.cache.set(key, g);
    }
    return g;
  }

  dispose(): void {
    for (const g of this.cache.values()) g.dispose();
    this.cache.clear();
  }
}

/** Props that rise with the walls (wallExtrude) rather than with the life layer. */
export const WALL_PROPS: ReadonlySet<PropKind> = new Set<PropKind>(["tower", "round_tower", "gatehouse", "wall_stairs"]);
