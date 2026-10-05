// Quick software-rasterised oblique view of a few assembled 3D tiles, to sanity
// check terrain relief, walls, slabs, props and figures. Props are drawn as
// crude low-poly stand-ins (the real models come from style packs).
//   cd packages/core && zig build wasm
//   bun packages/core-geo/scripts/render-3d.ts [out.png] [core.wasm]
// Needs ImageMagick `convert` (PPM -> PNG).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CoreGeo, rotatePoint, type GeoFigure, type GeoTile3D } from "../src";

const here = import.meta.dir;
const outPng = resolve(process.argv[2] ?? resolve(here, "../../../docs/research/geo-3d.png"));
const wasmPath = resolve(process.argv[3] ?? resolve(here, "../../core/zig-out/bin/core.wasm"));
const geo = await CoreGeo.instantiate(readFileSync(wasmPath));

type V3 = [number, number, number];
type RGB = [number, number, number];
const W = 1600;
const H = 1000;
const SS = 2; // supersampling
const FW = W * SS;
const FH = H * SS;
const color = new Float32Array(FW * FH * 3).fill(0.93);
const depth = new Float32Array(FW * FH).fill(Infinity);

// --- camera -----------------------------------------------------------------
const board: [string, number, number, number][] = [
  ["fx-road-curve", 1, 0, 0],
  ["fx-cap", 2, 1, 0],
  ["fx-cloister-road", 0, 2, 0],
  ["fx-cap", 1, 0, 1],
  ["fx-city4", 0, 1, 1],
  ["fx-cap", 3, 2, 1],
  ["fx-crossroads3", 0, 0, 2],
  ["fx-cap", 0, 1, 2],
  ["fx-river-bridge", 0, 2, 2],
  ["fx-garden-road", 1, 3, 1],
  ["fx-corner-road", 2, 3, 2],
];
const center: V3 = [2.0, 0, 1.55];
const eye: V3 = [center[0] + 0.9, 3.0, center[2] + 4.1];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const fwd = norm(sub(center, eye));
const right = norm(cross(fwd, [0, 1, 0]));
const up = cross(right, fwd);
const focal = (FH / 2) / Math.tan((30 * Math.PI) / 180 / 2);
const light = norm([-0.45, 1, 0.35]);

function project(p: V3): V3 {
  const d = sub(p, eye);
  const z = dot(d, fwd);
  return [FW / 2 + (dot(d, right) * focal) / z, FH / 2 - (dot(d, up) * focal) / z, z];
}

function tri(a: V3, b: V3, c: V3, colIn: RGB | [RGB, RGB, RGB], n?: V3) {
  const cols: [RGB, RGB, RGB] = typeof colIn[0] === "number" ? [colIn as RGB, colIn as RGB, colIn as RGB] : (colIn as [RGB, RGB, RGB]);
  const nn = n ?? norm(cross(sub(b, a), sub(c, a)));
  const shade = 0.42 + 0.58 * Math.max(0, dot(nn, light));
  const pa = project(a);
  const pb = project(b);
  const pc = project(c);
  const minX = Math.max(0, Math.floor(Math.min(pa[0], pb[0], pc[0])));
  const maxX = Math.min(FW - 1, Math.ceil(Math.max(pa[0], pb[0], pc[0])));
  const minY = Math.max(0, Math.floor(Math.min(pa[1], pb[1], pc[1])));
  const maxY = Math.min(FH - 1, Math.ceil(Math.max(pa[1], pb[1], pc[1])));
  const area = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]);
  if (Math.abs(area) < 1e-9) return;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const w0 = ((pb[0] - px) * (pc[1] - py) - (pb[1] - py) * (pc[0] - px)) / area;
      const w1 = ((pc[0] - px) * (pa[1] - py) - (pc[1] - py) * (pa[0] - px)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = w0 * pa[2] + w1 * pb[2] + w2 * pc[2];
      const i = y * FW + x;
      if (z >= depth[i]!) continue;
      depth[i] = z;
      for (let ch = 0; ch < 3; ch++) color[i * 3 + ch] = (w0 * cols[0][ch]! + w1 * cols[1][ch]! + w2 * cols[2][ch]!) * shade;
    }
  }
}

// --- palette (a "tabletop" style pack would supply these) -------------------
const KIND_COL: Record<string, RGB> = {
  field: [0.42, 0.68, 0.22],
  city: [0.78, 0.6, 0.4],
  road: [0.9, 0.84, 0.68],
  river: [0.3, 0.45, 0.5],
  cloister: [0.42, 0.68, 0.22],
  garden: [0.36, 0.62, 0.2],
};
const ROOFS: RGB[] = [
  [0.72, 0.25, 0.15],
  [0.66, 0.3, 0.18],
  [0.78, 0.33, 0.2],
  [0.6, 0.22, 0.14],
];
const STONE: RGB = [0.72, 0.68, 0.58];
const WATER: RGB = [0.32, 0.58, 0.85];
const SLAB: RGB = [0.92, 0.86, 0.72];
const PLAYER: RGB[] = [
  [0.85, 0.12, 0.1],
  [0.15, 0.3, 0.8],
  [0.95, 0.8, 0.1],
  [0.12, 0.55, 0.2],
  [0.1, 0.1, 0.1],
];

// --- placement --------------------------------------------------------------
function place(p: V3, rot: number, cx: number, cz: number): V3 {
  const [x, z] = rotatePoint(p[0], p[2], rot);
  return [x + cx, p[1], z + cz];
}
function placeN(n: V3, rot: number): V3 {
  const [x, z] = rotatePoint(n[0] + 0.5, n[2] + 0.5, rot);
  return [x - 0.5, n[1], z - 0.5];
}

function drawTile(g: GeoTile3D, rot: number, cx: number, cz: number) {
  const P = g.positions;
  const N = g.normals;
  const v = (i: number): V3 => place([P[i * 3]!, P[i * 3 + 1]!, P[i * 3 + 2]!], rot, cx, cz);
  const n = (i: number): V3 => placeN([N[i * 3]!, N[i * 3 + 1]!, N[i * 3 + 2]!], rot);
  for (const grp of g.groups) {
    for (let k = grp.start; k < grp.start + grp.count; k += 3) {
      const a = g.indices[k]!;
      const b = g.indices[k + 1]!;
      const c = g.indices[k + 2]!;
      let col: RGB | [RGB, RGB, RGB];
      if (grp.material === "terrain") {
        const kc = (vi: number): RGB => KIND_COL[g.features[g.featureIds[vi]!]?.kind ?? "field"] ?? KIND_COL.field!;
        col = [kc(a), kc(b), kc(c)];
      } else if (grp.material === "wall") col = STONE;
      else if (grp.material === "water") col = WATER;
      else col = SLAB;
      const na = n(a);
      const nb = n(b);
      const nc = n(c);
      tri(v(a), v(b), v(c), col, norm([na[0] + nb[0] + nc[0], na[1] + nb[1] + nc[1], na[2] + nb[2] + nc[2]]));
    }
  }
}

// crude prop stand-ins built from boxes/prisms in prop-local space
function box(o: V3, hx: number, hz: number, y0: number, y1: number, yaw: number, col: RGB, emit: (a: V3, b: V3, c: V3, col: RGB) => void) {
  const cs = [
    [-hx, -hz],
    [hx, -hz],
    [hx, hz],
    [-hx, hz],
  ].map(([x, z]) => {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    return [o[0] + x! * c + z! * s, o[2] - x! * s + z! * c] as [number, number];
  });
  for (let i = 0; i < 4; i++) {
    const [ax, az] = cs[i]!;
    const [bx, bz] = cs[(i + 1) % 4]!;
    emit([ax, o[1] + y0, az], [bx, o[1] + y0, bz], [bx, o[1] + y1, bz], col);
    emit([ax, o[1] + y0, az], [bx, o[1] + y1, bz], [ax, o[1] + y1, az], col);
  }
  const t = cs.map(([x, z]) => [x, o[1] + y1, z] as V3);
  emit(t[0]!, t[1]!, t[2]!, col);
  emit(t[0]!, t[2]!, t[3]!, col);
}
function roof(o: V3, hx: number, hz: number, y0: number, h: number, yaw: number, col: RGB, emit: (a: V3, b: V3, c: V3, col: RGB) => void) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const tr = (x: number, y: number, z: number): V3 => [o[0] + x * c + z * s, o[1] + y, o[2] - x * s + z * c];
  const a = tr(-hx, y0, -hz);
  const b = tr(hx, y0, -hz);
  const cc = tr(hx, y0, hz);
  const d = tr(-hx, y0, hz);
  const r0 = tr(-hx, y0 + h, 0);
  const r1 = tr(hx, y0 + h, 0);
  emit(a, b, r1, col);
  emit(a, r1, r0, col);
  emit(d, r0, r1, col);
  emit(d, r1, cc, col);
  emit(a, r0, d, col);
  emit(b, cc, r1, col);
}
function cone(o: V3, r: number, y0: number, h: number, col: RGB, emit: (a: V3, b: V3, c: V3, col: RGB) => void, sides = 7) {
  const apex: V3 = [o[0], o[1] + y0 + h, o[2]];
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = ((i + 1) / sides) * Math.PI * 2;
    emit([o[0] + r * Math.cos(a0), o[1] + y0, o[2] + r * Math.sin(a0)], [o[0] + r * Math.cos(a1), o[1] + y0, o[2] + r * Math.sin(a1)], apex, col);
  }
}
function prism(o: V3, r: number, y0: number, y1: number, col: RGB, emit: (a: V3, b: V3, c: V3, col: RGB) => void, sides = 8) {
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = ((i + 1) / sides) * Math.PI * 2;
    const p0: V3 = [o[0] + r * Math.cos(a0), o[1] + y0, o[2] + r * Math.sin(a0)];
    const p1: V3 = [o[0] + r * Math.cos(a1), o[1] + y0, o[2] + r * Math.sin(a1)];
    emit(p0, p1, [p1[0], o[1] + y1, p1[2]], col);
    emit(p0, [p1[0], o[1] + y1, p1[2]], [p0[0], o[1] + y1, p0[2]], col);
    emit([o[0], o[1] + y1, o[2]], [p0[0], o[1] + y1, p0[2]], [p1[0], o[1] + y1, p1[2]], col);
  }
}

function drawProps(g: GeoTile3D, rot: number, cx: number, cz: number) {
  const emit = (a: V3, b: V3, c: V3, col: RGB) => tri(place(a, rot, cx, cz), place(b, rot, cx, cz), place(c, rot, cx, cz), col);
  for (const p of g.props) {
    const o = p.position;
    const s = p.scale;
    switch (p.prop) {
      case "house": {
        const h = 0.026 * s * p.height;
        box(o, 0.021 * s, 0.016 * s, 0, h, p.yaw, [0.9, 0.85, 0.72], emit);
        roof(o, 0.023 * s, 0.018 * s, h, 0.018 * s, p.yaw, ROOFS[p.tint % 4]!, emit);
        break;
      }
      case "tower":
        box(o, 0.017, 0.017, -0.01, 0.1 * p.height, p.yaw, STONE, emit);
        break;
      case "round_tower":
        prism(o, 0.018, -0.01, 0.095 * p.height, STONE, emit);
        cone(o, 0.022, 0.095 * p.height, 0.04, ROOFS[p.tint % 4]!, emit);
        break;
      case "gatehouse":
        box(o, 0.035, 0.02, -0.01, 0.1, p.yaw + Math.PI / 2, STONE, emit);
        break;
      case "wall_stairs":
        box(o, 0.02, 0.01, 0, 0.04, p.yaw, STONE, emit);
        break;
      case "chapel":
        box(o, 0.085 * s, 0.06 * s, 0, 0.06 * s, p.yaw, [0.95, 0.9, 0.78], emit);
        roof(o, 0.09 * s, 0.065 * s, 0.06 * s, 0.045 * s, p.yaw, ROOFS[0]!, emit);
        box([o[0] + 0.07 * s * Math.sin(p.yaw), o[1], o[2] + 0.07 * s * Math.cos(p.yaw)], 0.02, 0.02, 0, 0.14 * s, p.yaw, [0.95, 0.9, 0.78], emit);
        break;
      case "tree":
        prism(o, 0.004, 0, 0.012, [0.4, 0.28, 0.15], emit, 4);
        cone(o, 0.02 * s, 0.01, 0.05 * s, [0.12, 0.38, 0.14], emit);
        break;
      case "bush":
        cone(o, 0.011 * s, 0, 0.016 * s, [0.1, 0.3, 0.12], emit, 5);
        break;
      case "sheep":
        box(o, 0.009, 0.006, 0.002, 0.012, p.yaw, [0.97, 0.97, 0.95], emit);
        break;
      case "cow":
        box(o, 0.012, 0.007, 0.002, 0.016, p.yaw, [0.45, 0.3, 0.2], emit);
        break;
      case "crop":
        box(o, 0.035, 0.025, 0, 0.004, p.yaw, [0.88, 0.78, 0.3], emit);
        break;
      case "mill":
        box(o, 0.025, 0.02, 0, 0.05, p.yaw, [0.9, 0.85, 0.72], emit);
        roof(o, 0.028, 0.022, 0.05, 0.025, p.yaw, ROOFS[1]!, emit);
        break;
      case "fountain":
        prism(o, 0.035, 0, 0.012, STONE, emit);
        prism(o, 0.028, 0.012, 0.014, WATER, emit);
        break;
      case "duck":
        box(o, 0.005, 0.003, 0, 0.006, p.yaw, [0.95, 0.95, 0.9], emit);
        break;
      case "cart":
        box(o, 0.012, 0.02, 0.004, 0.018, p.yaw, [0.5, 0.33, 0.18], emit);
        break;
      case "bridge":
        box(o, 0.075, 0.06, -0.005, 0.01, p.yaw, STONE, emit);
        break;
    }
  }
}

function drawFigure(fig: GeoFigure, at: V3, yaw: number, scale: number, col: RGB) {
  const P = fig.positions;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const tr = (i: number): V3 => {
    const x = P[i * 3]! * scale;
    const y = P[i * 3 + 1]! * scale;
    const z = P[i * 3 + 2]! * scale;
    return [at[0] + x * c + z * s, at[1] + y, at[2] - x * s + z * c];
  };
  for (let k = 0; k < fig.indices.length; k += 3) tri(tr(fig.indices[k]!), tr(fig.indices[k + 1]!), tr(fig.indices[k + 2]!), col);
}

// --- draw -------------------------------------------------------------------
const standing = geo.figure("meeple", "standing");
const lying = geo.figure("meeple", "lying");
const abbot = geo.figure("abbot", "standing");
let player = 0;
for (const [id, rot, cx, cz] of board) {
  const g = geo.tile3d(id, 48);
  drawTile(g, rot, cx, cz);
  drawProps(g, rot, cx, cz);
  // a figure on a few features to check anchors and scale
  const pick = g.features.findIndex((f) => f.kind === "city" || f.kind === "cloister" || f.kind === "garden");
  const fieldIdx = g.features.findIndex((f) => f.kind === "field");
  for (const fi of [pick, (cx + cz) % 2 === 0 ? fieldIdx : -1]) {
    if (fi < 0) continue;
    const a = g.anchors[fi]!;
    const pos = place(a.position, rot, cx, cz);
    const kind = g.features[fi]!.kind;
    const fig = kind === "garden" || (kind === "cloister" && cx === 2) ? abbot : a.pose === "lying" ? lying : standing;
    drawFigure(fig, pos, a.yaw - (rot * Math.PI) / 2, a.scale, PLAYER[player++ % PLAYER.length]!);
  }
}

// --- output: downsample, PPM -> PNG --------------------------------------------
const ppm = Buffer.alloc(32 + W * H * 3);
const header = `P6\n${W} ${H}\n255\n`;
ppm.write(header, 0, "ascii");
let o = header.length;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    for (let ch = 0; ch < 3; ch++) {
      let acc = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) acc += color[((y * SS + sy) * FW + x * SS + sx) * 3 + ch]!;
      ppm[o++] = Math.max(0, Math.min(255, Math.round((acc / (SS * SS)) * 255)));
    }
  }
}
const ppmPath = `${outPng}.ppm`;
writeFileSync(ppmPath, ppm.subarray(0, o));
execFileSync("convert", [ppmPath, outPng]);
execFileSync("rm", [ppmPath]);
console.log(`wrote ${outPng}`);
