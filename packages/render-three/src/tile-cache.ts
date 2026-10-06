// Per-(tile, rot, resolution) geometry built from core-geo CGEO buffers.
// Rotation is baked in (positions, normals, props, anchors), so a placed tile
// is just a translated mesh, and identical tiles share buffers. Everything
// here is style-agnostic: colours come from material uniforms.
import * as THREE from "three/webgpu";
import type { GeoFeatureKind, GeoTile3D, PropKind } from "@carcassonne/core-geo";
import { NO_FEATURE } from "./picking";

/** What the cache needs from @carcassonne/core-geo's `CoreGeo`. */
export interface GeoSource {
  tile3d(tile: string | number, resolution?: number, slab?: number): GeoTile3D;
}

export interface PlacedProp {
  prop: PropKind;
  variant: number;
  tint: number;
  feature: number;
  /** Tile-local placed position (rotation applied), x/z in 0..1. */
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  height: number;
}

export interface PlacedAnchor {
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  pose: "standing" | "lying";
}

export interface TileGeometry {
  key: string;
  tile: string;
  rot: number;
  resolution: number;
  slab: number;
  /** Terrain + slab sides (one draw). Attributes: position, normal, uv, aKind (vec4), aMat (vec2: ao, slab). */
  ground: THREE.BufferGeometry;
  /** Masonry: walls, merlons, plinths (null when none). */
  wall: THREE.BufferGeometry | null;
  water: THREE.BufferGeometry | null;
  props: PlacedProp[];
  /** Per-feature anchors, placed (rotated). */
  anchors: PlacedAnchor[];
  /** Canonical anchors (for picking in canonical space). */
  canonicalAnchors: { x: number; z: number }[];
  features: { kind: GeoFeatureKind; ports: number }[];
  /** Canonical per-vertex feature ids of the terrain grid ((R+1)^2). */
  featureGrid: Uint8Array;
  /** Canonical decoded tile (positions etc.) for overlays. */
  data: GeoTile3D;
  /** Terrain triangles (indices into `data.positions`) per feature, for highlight overlays. */
  featureTriangles: Map<number, Uint32Array>;
}

const KIND_SLOT: Record<GeoFeatureKind, number> = {
  field: 0,
  cloister: 0,
  garden: 0,
  road: 1,
  city: 2,
  river: 3,
};

/** Clockwise quarter turns seen from above: (x, z) -> (1 - z, x) about the tile centre. */
export function rotXZ(x: number, z: number, rot: number): [number, number] {
  let px = x;
  let pz = z;
  for (let i = 0; i < (((rot % 4) + 4) % 4); i++) {
    const t = px;
    px = 1 - pz;
    pz = t;
  }
  return [px, pz];
}

function rotDir(x: number, z: number, rot: number): [number, number] {
  let px = x;
  let pz = z;
  for (let i = 0; i < (((rot % 4) + 4) % 4); i++) {
    const t = px;
    px = -pz;
    pz = t;
  }
  return [px, pz];
}

/** Baked AO strength contributed by a prop at distance d. */
function occluder(prop: PropKind): { r: number; k: number } | null {
  switch (prop) {
    case "house":
      return { r: 0.06, k: 0.38 };
    case "tower":
    case "round_tower":
      return { r: 0.06, k: 0.45 };
    case "gatehouse":
      return { r: 0.07, k: 0.4 };
    case "chapel":
      return { r: 0.14, k: 0.35 };
    case "bush":
    case "tree":
      return { r: 0.022, k: 0.3 };
    default:
      return null;
  }
}

/** Box-blur a per-vertex vec`n` attribute over the (R+1)^2 terrain grid (in place). */
export function blurGrid(a: Float32Array, R: number, n: number, passes: number): void {
  const W = R + 1;
  const tmp = new Float32Array(W * W * n);
  for (let p = 0; p < passes; p++) {
    for (let j = 0; j < W; j++) {
      for (let i = 0; i < W; i++) {
        for (let c = 0; c < n; c++) {
          let sum = 0;
          let cnt = 0;
          for (let dj = -1; dj <= 1; dj++) {
            const jj = j + dj;
            if (jj < 0 || jj >= W) continue;
            for (let di = -1; di <= 1; di++) {
              const ii = i + di;
              if (ii < 0 || ii >= W) continue;
              const w = di === 0 && dj === 0 ? 2 : 1;
              sum += a[(jj * W + ii) * n + c]! * w;
              cnt += w;
            }
          }
          tmp[(j * W + i) * n + c] = sum / cnt;
        }
      }
    }
    a.set(tmp.subarray(0, W * W * n));
  }
}

export class TileGeometryCache {
  private cache = new Map<string, TileGeometry>();
  private decoded = new Map<string, GeoTile3D>();
  hits = 0;
  misses = 0;

  constructor(
    private geo: GeoSource,
    private opts: { slab?: number } = {},
  ) {}

  get size(): number {
    return this.cache.size;
  }

  static key(tile: string, rot: number, resolution: number): string {
    return `${tile}|${((rot % 4) + 4) % 4}|${resolution}`;
  }

  /** Decoded canonical geo for a tile (cached per tile + resolution). */
  decode(tile: string, resolution: number): GeoTile3D {
    const k = `${tile}|${resolution}`;
    let d = this.decoded.get(k);
    if (!d) {
      d = this.geo.tile3d(tile, resolution, this.opts.slab);
      this.decoded.set(k, d);
    }
    return d;
  }

  get(tile: string, rot: number, resolution: number): TileGeometry {
    const key = TileGeometryCache.key(tile, rot, resolution);
    const hit = this.cache.get(key);
    if (hit) {
      this.hits++;
      return hit;
    }
    this.misses++;
    const g = buildTileGeometry(this.decode(tile, resolution), tile, ((rot % 4) + 4) % 4, resolution, key);
    this.cache.set(key, g);
    return g;
  }

  /** Drops everything (e.g. resolution change). Callers must not hold old geometries. */
  clear(): void {
    for (const g of this.cache.values()) {
      g.ground.dispose();
      g.wall?.dispose();
      g.water?.dispose();
    }
    this.cache.clear();
    this.decoded.clear();
  }
}

export function buildTileGeometry(d: GeoTile3D, tile: string, rot: number, resolution: number, key = ""): TileGeometry {
  const nv = d.positions.length / 3;
  const pos = new Float32Array(nv * 3);
  const nrm = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    const [x, z] = rotXZ(d.positions[i * 3]!, d.positions[i * 3 + 2]!, rot);
    pos[i * 3] = x;
    pos[i * 3 + 1] = d.positions[i * 3 + 1]!;
    pos[i * 3 + 2] = z;
    const [nx, nz] = rotDir(d.normals[i * 3]!, d.normals[i * 3 + 2]!, rot);
    nrm[i * 3] = nx;
    nrm[i * 3 + 1] = d.normals[i * 3 + 1]!;
    nrm[i * 3 + 2] = nz;
  }

  const props: PlacedProp[] = d.props.map((p) => {
    const [x, z] = rotXZ(p.position[0], p.position[2], rot);
    return { prop: p.prop, variant: p.variant, tint: p.tint, feature: p.feature, x, y: p.position[1], z, yaw: p.yaw - (rot * Math.PI) / 2, scale: p.scale, height: p.height };
  });

  // Per-vertex material attributes: kind weights + baked AO + slab flag.
  const R = resolution;
  const gridCount = (R + 1) * (R + 1);
  const kind = new Float32Array(nv * 4);
  const mat = new Float32Array(nv * 2);
  const slabGroup = d.groups.find((g) => g.material === "slab");
  const isSlab = new Uint8Array(nv);
  if (slabGroup) for (let k = slabGroup.start; k < slabGroup.start + slabGroup.count; k++) isSlab[d.indices[k]!] = 1;
  const wallGroup = d.groups.find((g) => g.material === "wall");
  // wall sample points for AO (canonical xz)
  const wallPts: number[] = [];
  if (wallGroup) {
    const seen = new Set<number>();
    for (let k = wallGroup.start; k < wallGroup.start + wallGroup.count; k++) {
      const vi = d.indices[k]!;
      if (seen.has(vi)) continue;
      seen.add(vi);
      if (d.positions[vi * 3 + 1]! > 0.03) wallPts.push(d.positions[vi * 3]!, d.positions[vi * 3 + 2]!);
    }
  }
  const occ = d.props.flatMap((p) => {
    const o = occluder(p.prop);
    return o ? [{ x: p.position[0], z: p.position[2], r: o.r * Math.max(0.6, p.scale), k: o.k }] : [];
  });
  for (let i = 0; i < nv; i++) {
    if (isSlab[i]) {
      mat[i * 2] = 1;
      mat[i * 2 + 1] = 1;
      continue;
    }
    const f = d.featureIds[i]!;
    const fk = f === NO_FEATURE ? "road" : (d.features[f]?.kind ?? "field");
    kind[i * 4 + KIND_SLOT[fk]] = 1;
    let ao = 1;
    if (i < gridCount) {
      const x = d.positions[i * 3]!;
      const z = d.positions[i * 3 + 2]!;
      for (const o of occ) {
        const dd = (x - o.x) ** 2 + (z - o.z) ** 2;
        if (dd < o.r * o.r * 4) ao *= 1 - o.k * Math.exp(-dd / (o.r * o.r));
      }
      let wd = Infinity;
      for (let k = 0; k < wallPts.length; k += 2) wd = Math.min(wd, (x - wallPts[k]!) ** 2 + (z - wallPts[k + 1]!) ** 2);
      if (wd < 0.01) ao *= 1 - 0.45 * Math.exp(-wd / 0.0012);
    }
    mat[i * 2] = ao;
    mat[i * 2 + 1] = 0;
  }

  // soften the per-vertex classification on the terrain grid (soft-edged
  // roads and courtyards instead of grid staircases)
  blurGrid(kind, R, 4, 2);

  const posA = new THREE.BufferAttribute(pos, 3);
  const nrmA = new THREE.BufferAttribute(nrm, 3);
  const uvA = new THREE.BufferAttribute(d.uvs, 2);
  const kindA = new THREE.BufferAttribute(kind, 4);
  const matA = new THREE.BufferAttribute(mat, 2);
  const make = (materials: string[]): THREE.BufferGeometry | null => {
    const groups = d.groups.filter((g) => materials.includes(g.material));
    const count = groups.reduce((s, g) => s + g.count, 0);
    if (count === 0) return null;
    const idx = new Uint32Array(count);
    let o = 0;
    for (const g of groups) {
      idx.set(d.indices.subarray(g.start, g.start + g.count), o);
      o += g.count;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", posA);
    geom.setAttribute("normal", nrmA);
    geom.setAttribute("uv", uvA);
    geom.setAttribute("aKind", kindA);
    geom.setAttribute("aMat", matA);
    geom.setIndex(new THREE.BufferAttribute(idx, 1));
    // bounds over the referenced vertices only
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    for (let k = 0; k < idx.length; k++) {
      const vi = idx[k]!;
      box.expandByPoint(v.set(pos[vi * 3]!, pos[vi * 3 + 1]!, pos[vi * 3 + 2]!));
    }
    geom.boundingBox = box;
    geom.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
    return geom;
  };

  // terrain triangles per feature (for hover / scoring highlights)
  const featureTriangles = new Map<number, Uint32Array>();
  const terr = d.groups.find((g) => g.material === "terrain");
  if (terr) {
    const lists = new Map<number, number[]>();
    for (let k = terr.start; k < terr.start + terr.count; k += 3) {
      const a = d.indices[k]!;
      const b = d.indices[k + 1]!;
      const c = d.indices[k + 2]!;
      const fa = d.featureIds[a]!;
      const fb = d.featureIds[b]!;
      const fc = d.featureIds[c]!;
      // a triangle belongs to a feature when at least two corners do
      const f = fa === fb || fa === fc ? fa : fb === fc ? fb : NO_FEATURE;
      if (f === NO_FEATURE) continue;
      let l = lists.get(f);
      if (!l) lists.set(f, (l = []));
      l.push(a, b, c);
    }
    for (const [f, l] of lists) featureTriangles.set(f, Uint32Array.from(l));
  }

  return {
    key,
    tile,
    rot,
    resolution,
    slab: d.slab,
    ground: make(["terrain", "slab"])!,
    wall: make(["wall"]),
    water: make(["water"]),
    props,
    anchors: d.anchors.map((a) => {
      const [x, z] = rotXZ(a.position[0], a.position[2], rot);
      return { x, y: a.position[1], z, yaw: a.yaw - (rot * Math.PI) / 2, scale: a.scale, pose: a.pose };
    }),
    canonicalAnchors: d.anchors.map((a) => ({ x: a.position[0], z: a.position[2] })),
    features: d.features.map((f) => ({ kind: f.kind, ports: f.ports })),
    featureGrid: d.featureIds.subarray(0, gridCount),
    data: d,
    featureTriangles,
  };
}
