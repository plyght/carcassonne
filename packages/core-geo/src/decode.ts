// Decoder for CGEO buffers (packages/core/src/geo/README.md) into typed arrays.
import {
  FEATURE_KINDS,
  FIGURE_KINDS,
  KIND_FIGURE,
  POSES,
  KIND_2D,
  KIND_3D,
  MAGIC,
  MATERIALS,
  PATH_ROLES,
  PROPS,
  TAG,
  TILE_SET,
  TILE_SPECIAL,
  type GeoFeatureKind,
  type FigurePose,
  type FigureShape,
  type GeoMaterial,
  type PathRole,
  type PropKind,
} from "./format";

export interface GeoSection {
  tag: number;
  offset: number;
  length: number;
  count: number;
}

export interface GeoMeta {
  id: string;
  roadHalfWidth: number;
  riverHalfWidth: number;
  featureCount: number;
  special: (typeof TILE_SPECIAL)[number];
  set: (typeof TILE_SET)[number];
}

export interface GeoFeature {
  index: number;
  kind: GeoFeatureKind;
  pennants: number;
  /** 12-bit port mask (engine/tile.zig). */
  ports: number;
  /** 2D meeple anchor in canonical tile space (x right, y down, 0..1). */
  anchor: [number, number];
}

export interface GeoPath {
  feature: number; // 255 = none
  kind: GeoFeatureKind;
  role: PathRole;
  closed: boolean;
  /** Stroke width for centerlines/walls (tile units); 0 for fills. */
  width: number;
  /** Interleaved x,y (a subarray view of `GeoTile2D.points`). */
  points: Float32Array;
}

export interface GeoPennant {
  feature: number;
  x: number;
  y: number;
}

export interface GeoTile2D {
  meta: GeoMeta;
  features: GeoFeature[];
  /** In recommended draw order (fields, rivers, roads, plazas, cities, walls, buildings). */
  paths: GeoPath[];
  points: Float32Array;
  pennants: GeoPennant[];
}

export interface GeoGroup {
  /** First index (into `indices`) and index count, like THREE.BufferGeometry.addGroup. */
  start: number;
  count: number;
  material: GeoMaterial;
  materialIndex: number;
}

export interface GeoProp {
  prop: PropKind;
  feature: number;
  /** Model variant; style packs pick `variant % variantsAvailable`. */
  variant: number;
  /** Palette index for per-instance tint (e.g. roof colours). */
  tint: number;
  /** x (east), y (up), z (south), canonical tile space. */
  position: [number, number, number];
  /** Radians about +y; 0 faces +z. */
  yaw: number;
  scale: number;
  /** Extra vertical scale (houses vary in height). */
  height: number;
}

export interface GeoAnchor3D {
  /** x, y (ground / plinth / water surface), z in canonical tile space. */
  position: [number, number, number];
  /** Radians about +y; 0 faces +z. */
  yaw: number;
  /** Suggested figure height in tile units (figures are chunky). */
  scale: number;
  pose: FigurePose;
}

export interface GeoTile3D {
  meta: GeoMeta;
  features: GeoFeature[];
  positions: Float32Array; // xyz
  normals: Float32Array; // xyz
  uvs: Float32Array; // uv
  /** Per-vertex feature index (255 = none). */
  featureIds: Uint8Array;
  indices: Uint32Array;
  groups: GeoGroup[];
  props: GeoProp[];
  /** Per-feature 3D meeple anchors (index = feature index). */
  anchors: GeoAnchor3D[];
  /** Slab thickness below y = 0 (0 = no slab). */
  slab: number;
}

export interface GeoFigure {
  shape: FigureShape;
  pose: FigurePose;
  height: number;
  thickness: number;
  bevel: number;
  /** 2D token outline, interleaved x,y; y down, centred (x ~[-0.5,0.5], y [-0.5,0.5]), height 1. */
  outline: Float32Array;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

export class GeoFormatError extends Error {}

function bytesOf(input: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
}

/** Copies into a fresh, 4-byte aligned buffer when needed so typed views work. */
function aligned(bytes: Uint8Array): Uint8Array {
  if (bytes.byteOffset % 4 === 0) return bytes;
  return bytes.slice();
}

export function readSections(input: ArrayBuffer | ArrayBufferView): {
  kind: number;
  bytes: Uint8Array;
  sections: Map<number, GeoSection>;
} {
  const bytes = aligned(bytesOf(input));
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 16 || dv.getUint32(0, true) !== MAGIC) throw new GeoFormatError("not a CGEO buffer");
  const version = dv.getUint16(4, true);
  if (version !== 1) throw new GeoFormatError(`unsupported CGEO version ${version}`);
  const kind = dv.getUint16(6, true);
  const total = dv.getUint32(8, true);
  if (total > bytes.byteLength) throw new GeoFormatError("truncated CGEO buffer");
  const n = dv.getUint32(12, true);
  const sections = new Map<number, GeoSection>();
  for (let i = 0; i < n; i++) {
    const o = 16 + 16 * i;
    const s = {
      tag: dv.getUint32(o, true),
      offset: dv.getUint32(o + 4, true),
      length: dv.getUint32(o + 8, true),
      count: dv.getUint32(o + 12, true),
    };
    if (s.offset + s.length > total) throw new GeoFormatError("section out of range");
    sections.set(s.tag, s);
  }
  return { kind, bytes, sections };
}

function need(sections: Map<number, GeoSection>, t: number): GeoSection {
  const s = sections.get(t);
  if (!s) throw new GeoFormatError(`missing section ${String.fromCharCode(t & 255, (t >> 8) & 255, (t >> 16) & 255, t >>> 24)}`);
  return s;
}

function f32(bytes: Uint8Array, s: GeoSection): Float32Array {
  return new Float32Array(bytes.buffer, bytes.byteOffset + s.offset, s.length / 4);
}

function decodeMeta(bytes: Uint8Array, sections: Map<number, GeoSection>): GeoMeta {
  const s = need(sections, TAG.META);
  const dv = new DataView(bytes.buffer, bytes.byteOffset + s.offset, s.length);
  const idLen = dv.getUint16(14, true);
  const id = new TextDecoder().decode(bytes.subarray(s.offset + 16, s.offset + 16 + idLen));
  return {
    id,
    roadHalfWidth: dv.getFloat32(0, true),
    riverHalfWidth: dv.getFloat32(4, true),
    featureCount: dv.getUint32(8, true),
    special: TILE_SPECIAL[dv.getUint8(12)] ?? "none",
    set: TILE_SET[dv.getUint8(13)] ?? "base",
  };
}

function decodeFeatures(bytes: Uint8Array, sections: Map<number, GeoSection>): GeoFeature[] {
  const s = need(sections, TAG.FEAT);
  const dv = new DataView(bytes.buffer, bytes.byteOffset + s.offset, s.length);
  const out: GeoFeature[] = [];
  for (let i = 0; i < s.count; i++) {
    const o = i * 12;
    out.push({
      index: i,
      kind: FEATURE_KINDS[dv.getUint8(o)] ?? "field",
      pennants: dv.getUint8(o + 1),
      ports: dv.getUint16(o + 2, true),
      anchor: [dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true)],
    });
  }
  return out;
}

export function decodeGeo2D(input: ArrayBuffer | ArrayBufferView): GeoTile2D {
  const { kind, bytes, sections } = readSections(input);
  if (kind !== KIND_2D) throw new GeoFormatError(`expected a 2D buffer, got kind ${kind}`);
  const points = f32(bytes, need(sections, TAG.PNTS));
  const ps = need(sections, TAG.PATH);
  const dv = new DataView(bytes.buffer, bytes.byteOffset + ps.offset, ps.length);
  const paths: GeoPath[] = [];
  for (let i = 0; i < ps.count; i++) {
    const o = i * 16;
    const start = dv.getUint32(o + 4, true);
    const count = dv.getUint32(o + 8, true);
    paths.push({
      feature: dv.getUint8(o),
      role: PATH_ROLES[dv.getUint8(o + 1) as keyof typeof PATH_ROLES] ?? "region",
      closed: (dv.getUint8(o + 2) & 1) === 1,
      kind: FEATURE_KINDS[dv.getUint8(o + 3)] ?? "field",
      width: dv.getFloat32(o + 12, true),
      points: points.subarray(start * 2, (start + count) * 2),
    });
  }
  const pennants: GeoPennant[] = [];
  const pe = sections.get(TAG.PENN);
  if (pe) {
    const pdv = new DataView(bytes.buffer, bytes.byteOffset + pe.offset, pe.length);
    for (let i = 0; i < pe.count; i++) {
      pennants.push({ feature: pdv.getUint8(i * 12), x: pdv.getFloat32(i * 12 + 4, true), y: pdv.getFloat32(i * 12 + 8, true) });
    }
  }
  return { meta: decodeMeta(bytes, sections), features: decodeFeatures(bytes, sections), paths, points, pennants };
}

export function decodeGeo3D(input: ArrayBuffer | ArrayBufferView): GeoTile3D {
  const { kind, bytes, sections } = readSections(input);
  if (kind !== KIND_3D) throw new GeoFormatError(`expected a 3D buffer, got kind ${kind}`);
  const fea = need(sections, TAG.VFEA);
  const idx = need(sections, TAG.INDX);
  const groups: GeoGroup[] = [];
  const gs = sections.get(TAG.GRUP);
  if (gs) {
    const g = new Uint32Array(bytes.buffer, bytes.byteOffset + gs.offset, gs.count * 4);
    for (let i = 0; i < gs.count; i++) {
      const m = g[i * 4 + 2] ?? 0;
      groups.push({ start: g[i * 4] ?? 0, count: g[i * 4 + 1] ?? 0, materialIndex: m, material: MATERIALS[m] ?? "terrain" });
    }
  }
  const props: GeoProp[] = [];
  const pr = sections.get(TAG.PROP);
  if (pr) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset + pr.offset, pr.length);
    for (let i = 0; i < pr.count; i++) {
      const o = i * 28;
      props.push({
        prop: PROPS[dv.getUint8(o)] ?? "tree",
        feature: dv.getUint8(o + 1),
        variant: dv.getUint8(o + 2),
        tint: dv.getUint8(o + 3),
        position: [dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true), dv.getFloat32(o + 12, true)],
        yaw: dv.getFloat32(o + 16, true),
        scale: dv.getFloat32(o + 20, true),
        height: dv.getFloat32(o + 24, true),
      });
    }
  }
  const anchors: GeoAnchor3D[] = [];
  const an = need(sections, TAG.ANC3);
  {
    const dv = new DataView(bytes.buffer, bytes.byteOffset + an.offset, an.length);
    for (let i = 0; i < an.count; i++) {
      const o = i * 24;
      anchors.push({
        position: [dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true)],
        yaw: dv.getFloat32(o + 12, true),
        scale: dv.getFloat32(o + 16, true),
        pose: POSES[dv.getUint32(o + 20, true)] ?? "standing",
      });
    }
  }
  return {
    meta: decodeMeta(bytes, sections),
    features: decodeFeatures(bytes, sections),
    positions: f32(bytes, need(sections, TAG.VPOS)),
    normals: f32(bytes, need(sections, TAG.VNRM)),
    uvs: f32(bytes, need(sections, TAG.VUV0)),
    featureIds: new Uint8Array(bytes.buffer, bytes.byteOffset + fea.offset, fea.count),
    indices: new Uint32Array(bytes.buffer, bytes.byteOffset + idx.offset, idx.count),
    groups,
    props,
    anchors,
    slab: (() => {
      const sl = sections.get(TAG.SLAB);
      return sl ? new DataView(bytes.buffer, bytes.byteOffset + sl.offset, 4).getFloat32(0, true) : 0;
    })(),
  };
}

export function decodeGeoFigure(input: ArrayBuffer | ArrayBufferView): GeoFigure {
  const { kind, bytes, sections } = readSections(input);
  if (kind !== KIND_FIGURE) throw new GeoFormatError(`expected a figure buffer, got kind ${kind}`);
  const d = need(sections, TAG.FDIM);
  const dv = new DataView(bytes.buffer, bytes.byteOffset + d.offset, d.length);
  const idx = need(sections, TAG.INDX);
  return {
    shape: FIGURE_KINDS[dv.getUint8(0)] ?? "meeple",
    pose: POSES[dv.getUint8(1)] ?? "standing",
    height: dv.getFloat32(4, true),
    thickness: dv.getFloat32(8, true),
    bevel: dv.getFloat32(12, true),
    outline: f32(bytes, need(sections, TAG.OUTL)),
    positions: f32(bytes, need(sections, TAG.VPOS)),
    normals: f32(bytes, need(sections, TAG.VNRM)),
    uvs: f32(bytes, need(sections, TAG.VUV0)),
    indices: new Uint32Array(bytes.buffer, bytes.byteOffset + idx.offset, idx.count),
  };
}
