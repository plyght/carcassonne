// Procedural low-poly prop kit (no art assets). Each model is a BufferGeometry
// in prop-local space (tile units, +y up, yaw 0 faces +z) with a per-vertex
// `aPart` slot that the prop material maps through the style palette, so one
// InstancedMesh per (prop, variant) draws every part in one call and a style
// switch only rewrites the palette.
import * as THREE from "three/webgpu";
import type { PropKind } from "@carcassonne/core-geo";

/** Palette slots (`aPart`). Rows of the palette texture are the prop `tint`. */
export const PART = {
  plaster: 0,
  roof: 1,
  stone: 2,
  stoneDark: 3,
  foliage: 4,
  trunk: 5,
  wood: 6,
  dark: 7,
  sheep: 8,
  cow: 9,
  crop: 10,
  water: 11,
  grass: 12,
} as const;
export const PART_COUNT = 16;
export const TINT_COUNT = 4;

export interface KitOptions {
  /** Rounder silhouettes (more segments, puffier foliage) for toon styles. */
  rounded: boolean;
}

class Builder {
  pos: number[] = [];
  nrm: number[] = [];
  part: number[] = [];
  shade: number[] = [];
  constructor(private rounded = false) {}

  get segs(): number {
    return this.rounded ? 14 : 8;
  }

  tri(a: number[], b: number[], c: number[], part: number, shade = 1): void {
    const ux = b[0]! - a[0]!;
    const uy = b[1]! - a[1]!;
    const uz = b[2]! - a[2]!;
    const vx = c[0]! - a[0]!;
    const vy = c[1]! - a[1]!;
    const vz = c[2]! - a[2]!;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    for (const p of [a, b, c]) {
      this.pos.push(p[0]!, p[1]!, p[2]!);
      this.nrm.push(nx, ny, nz);
      this.part.push(part);
      // baked contact darkening near the ground
      this.shade.push(shade * (0.72 + 0.28 * Math.min(1, Math.max(0, p[1]! / 0.03))));
    }
  }

  quad(a: number[], b: number[], c: number[], d: number[], part: number, shade = 1): void {
    this.tri(a, b, c, part, shade);
    this.tri(a, c, d, part, shade);
  }

  /** Axis-aligned box centred at (cx, *, cz), from y0 to y1, optionally rotated by `yaw` about (ox, oz). */
  box(cx: number, cz: number, hx: number, hz: number, y0: number, y1: number, part: number, opt: { bottom?: boolean; yaw?: number; top?: boolean } = {}): void {
    const yaw = opt.yaw ?? 0;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const P = (x: number, y: number, z: number) => [cx + x * c + z * s, y, cz - x * s + z * c];
    const p = [P(-hx, 0, -hz), P(hx, 0, -hz), P(hx, 0, hz), P(-hx, 0, hz)];
    for (let i = 0; i < 4; i++) {
      const a = p[i]!;
      const b = p[(i + 1) % 4]!;
      this.quad([b[0]!, y0, b[2]!], [a[0]!, y0, a[2]!], [a[0]!, y1, a[2]!], [b[0]!, y1, b[2]!], part);
    }
    if (opt.top !== false) this.quad([p[3]![0]!, y1, p[3]![2]!], [p[2]![0]!, y1, p[2]![2]!], [p[1]![0]!, y1, p[1]![2]!], [p[0]![0]!, y1, p[0]![2]!], part);
    if (opt.bottom) this.quad([p[0]![0]!, y0, p[0]![2]!], [p[1]![0]!, y0, p[1]![2]!], [p[2]![0]!, y0, p[2]![2]!], [p[3]![0]!, y0, p[3]![2]!], part);
  }

  /** Gable roof over a box footprint; ridge along x. */
  gable(cx: number, cz: number, hx: number, hz: number, y0: number, h: number, part: number, gablePart: number, yaw = 0): void {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const P = (x: number, y: number, z: number) => [cx + x * c + z * s, y, cz - x * s + z * c];
    const o = 0.0075; // overhang
    const a = P(-hx - o, y0 - 0.003, -hz - o);
    const b = P(hx + o, y0 - 0.003, -hz - o);
    const cc = P(hx + o, y0 - 0.003, hz + o);
    const d = P(-hx - o, y0 - 0.003, hz + o);
    const r0 = P(-hx - o, y0 + h, 0);
    const r1 = P(hx + o, y0 + h, 0);
    this.quad(b, a, r0, r1, part);
    this.quad(d, cc, r1, r0, part);
    // gable ends (wall-coloured triangles, inset under the overhang)
    const ga = P(-hx, y0, -hz);
    const gb = P(-hx, y0, hz);
    const gr = P(-hx, y0 + h * 0.95, 0);
    this.tri(ga, gb, gr, gablePart);
    const ha = P(hx, y0, hz);
    const hb = P(hx, y0, -hz);
    const hr = P(hx, y0 + h * 0.95, 0);
    this.tri(ha, hb, hr, gablePart);
    // underside of the overhang
    this.quad(a, b, cc, d, part, 0.6);
  }

  /** Hip / pyramid roof. */
  hip(cx: number, cz: number, hx: number, hz: number, y0: number, h: number, part: number, ridge = 0, yaw = 0): void {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const P = (x: number, y: number, z: number) => [cx + x * c + z * s, y, cz - x * s + z * c];
    const o = 0.005;
    const a = P(-hx - o, y0 - 0.003, -hz - o);
    const b = P(hx + o, y0 - 0.003, -hz - o);
    const cc = P(hx + o, y0 - 0.003, hz + o);
    const d = P(-hx - o, y0 - 0.003, hz + o);
    const r0 = P(-ridge, y0 + h, 0);
    const r1 = P(ridge, y0 + h, 0);
    this.quad(b, a, r0, r1, part);
    this.quad(d, cc, r1, r0, part);
    this.tri(a, d, r0, part);
    this.tri(cc, b, r1, part);
    this.quad(a, b, cc, d, part, 0.6);
  }

  cylinder(cx: number, cz: number, r: number, y0: number, y1: number, part: number, sides = this.segs, rTop = r): void {
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2;
      const a1 = ((i + 1) / sides) * Math.PI * 2;
      const p0 = [cx + r * Math.sin(a0), y0, cz + r * Math.cos(a0)];
      const p1 = [cx + r * Math.sin(a1), y0, cz + r * Math.cos(a1)];
      const q0 = [cx + rTop * Math.sin(a0), y1, cz + rTop * Math.cos(a0)];
      const q1 = [cx + rTop * Math.sin(a1), y1, cz + rTop * Math.cos(a1)];
      this.quad(p0, p1, q1, q0, part);
      this.tri([cx, y1, cz], q0, q1, part);
    }
  }

  cone(cx: number, cz: number, r: number, y0: number, h: number, part: number, sides = this.segs): void {
    const apex = [cx, y0 + h, cz];
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2;
      const a1 = ((i + 1) / sides) * Math.PI * 2;
      this.tri([cx + r * Math.sin(a0), y0, cz + r * Math.cos(a0)], [cx + r * Math.sin(a1), y0, cz + r * Math.cos(a1)], apex, part);
      this.tri([cx, y0, cz], [cx + r * Math.sin(a1), y0, cz + r * Math.cos(a1)], [cx + r * Math.sin(a0), y0, cz + r * Math.cos(a0)], part, 0.6);
    }
  }

  /** Low-poly blob (squashed icosphere) for foliage. */
  blob(cx: number, cy: number, cz: number, r: number, sy: number, part: number, seed = 0): void {
    const g = new THREE.IcosahedronGeometry(1, this.rounded ? 2 : 1);
    const p = g.getAttribute("position") as THREE.BufferAttribute;
    const idx = g.getIndex();
    const get = (i: number) => {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      // deterministic lumpy jitter
      const j = 1 + 0.12 * Math.sin(x * 7.1 + seed) * Math.cos(z * 5.3 + seed * 1.7) * (this.rounded ? 0.4 : 1);
      return [cx + x * r * j, cy + y * r * sy * j, cz + z * r * j];
    };
    const n = idx ? idx.count : p.count;
    for (let k = 0; k < n; k += 3) {
      const ia = idx ? idx.getX(k) : k;
      const ib = idx ? idx.getX(k + 1) : k + 1;
      const ic = idx ? idx.getX(k + 2) : k + 2;
      this.tri(get(ia), get(ib), get(ic), part);
    }
    g.dispose();
  }

  /** Thin dark rectangle on a vertical face (window / door), facing direction yaw. */
  plate(cx: number, cz: number, y0: number, y1: number, hw: number, yawFace: number, part: number, out = 0.0012): void {
    const nx = Math.sin(yawFace);
    const nz = Math.cos(yawFace);
    const tx = Math.cos(yawFace);
    const tz = -Math.sin(yawFace);
    const ox = cx + nx * out;
    const oz = cz + nz * out;
    this.quad([ox - tx * hw, y0, oz - tz * hw], [ox + tx * hw, y0, oz + tz * hw], [ox + tx * hw, y1, oz + tz * hw], [ox - tx * hw, y1, oz - tz * hw], part);
  }

  /** Merlons around the top rim of a box. */
  crenels(cx: number, cz: number, hx: number, hz: number, y: number, h: number, part: number): void {
    const m = 0.009;
    const nX = Math.max(2, Math.round((hx * 2) / (m * 2.2)));
    const nZ = Math.max(2, Math.round((hz * 2) / (m * 2.2)));
    for (let i = 0; i < nX; i++) {
      const x = -hx + m * 0.5 + (i * (2 * hx - m)) / (nX - 1);
      this.box(cx + x, cz - hz + m * 0.5, m * 0.5, m * 0.5, y, y + h, part);
      this.box(cx + x, cz + hz - m * 0.5, m * 0.5, m * 0.5, y, y + h, part);
    }
    for (let i = 1; i < nZ - 1; i++) {
      const z = -hz + m * 0.5 + (i * (2 * hz - m)) / (nZ - 1);
      this.box(cx - hx + m * 0.5, cz + z, m * 0.5, m * 0.5, y, y + h, part);
      this.box(cx + hx - m * 0.5, cz + z, m * 0.5, m * 0.5, y, y + h, part);
    }
  }

  ringCrenels(cx: number, cz: number, r: number, y: number, h: number, part: number): void {
    const n = this.rounded ? 10 : 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.box(cx + Math.sin(a) * (r - 0.005), cz + Math.cos(a) * (r - 0.005), 0.0055, 0.0045, y, y + h, part, { yaw: a });
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute("aPart", new THREE.Float32BufferAttribute(this.part, 1));
    g.setAttribute("aShade", new THREE.Float32BufferAttribute(this.shade, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Number of distinct models per prop kind (geo `variant % count`). */
export const VARIANTS: Record<PropKind, number> = {
  tower: 3,
  house: 6,
  chapel: 1,
  tree: 2,
  sheep: 1,
  cow: 1,
  cart: 1,
  mill: 1,
  fountain: 1,
  crop: 1,
  duck: 1,
  bridge: 1,
  bush: 3,
  gatehouse: 1,
  round_tower: 3,
  wall_stairs: 1,
};

// Heights (tile units) that line up with core/geo mesh.zig: city ground 0.012,
// wall top = 0.012 + 0.085.
const WALL_TOP = 0.097;

function windows(b: Builder, cx: number, cz: number, hx: number, hz: number, y: number, yaw: number, door = true): void {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const P = (x: number, z: number): [number, number] => [cx + x * c + z * s, cz - x * s + z * c];
  const ww = 0.0045;
  for (const side of [1, -1]) {
    const n = Math.max(1, Math.floor((hx * 2) / 0.028));
    for (let i = 0; i < n; i++) {
      const x = -hx + ((i + 0.5) * 2 * hx) / n;
      const [px, pz] = P(x, side * hz);
      if (door && side === 1 && i === 0) {
        b.plate(px, pz, 0, Math.min(y * 0.62, 0.022), ww * 1.2, yaw + (side === 1 ? 0 : Math.PI), PART.dark);
      } else {
        b.plate(px, pz, y * 0.52, y * 0.52 + 0.009, ww, yaw + (side === 1 ? 0 : Math.PI), PART.dark);
      }
    }
  }
}

function house(b: Builder, v: number): void {
  const P = PART.plaster;
  const R = PART.roof;
  switch (v) {
    case 0: {
      // long house
      b.box(0, 0, 0.042, 0.027, -0.01, 0.036, P);
      b.gable(0, 0, 0.042, 0.027, 0.036, 0.032, R, P);
      windows(b, 0, 0, 0.042, 0.027, 0.036, 0);
      break;
    }
    case 1: {
      // square house, hip roof
      b.box(0, 0, 0.032, 0.03, -0.01, 0.038, P);
      b.hip(0, 0, 0.032, 0.03, 0.038, 0.036, R, 0.006);
      windows(b, 0, 0, 0.032, 0.03, 0.038, 0);
      break;
    }
    case 2: {
      // tall narrow town house
      b.box(0, 0, 0.026, 0.025, -0.01, 0.058, P);
      b.gable(0, 0, 0.026, 0.025, 0.058, 0.03, R, P, Math.PI / 2);
      windows(b, 0, 0, 0.026, 0.025, 0.058, 0);
      b.plate(0, 0.025, 0.038, 0.047, 0.0045, 0, PART.dark);
      break;
    }
    case 3: {
      // L-shaped
      b.box(0.008, -0.008, 0.036, 0.021, -0.01, 0.036, P);
      b.gable(0.008, -0.008, 0.036, 0.021, 0.036, 0.027, R, P);
      b.box(-0.018, 0.016, 0.019, 0.024, -0.01, 0.031, P);
      b.gable(-0.018, 0.016, 0.019, 0.024, 0.031, 0.024, R, P, Math.PI / 2);
      windows(b, 0.008, -0.008, 0.036, 0.021, 0.036, 0, false);
      break;
    }
    case 4: {
      // house with chimney
      b.box(0, 0, 0.038, 0.026, -0.01, 0.034, P);
      b.gable(0, 0, 0.038, 0.026, 0.034, 0.03, R, P);
      b.box(0.022, 0.008, 0.005, 0.005, 0.04, 0.074, PART.stoneDark);
      windows(b, 0, 0, 0.038, 0.026, 0.034, 0);
      break;
    }
    default: {
      // two storeys with a jettied upper floor
      b.box(0, 0, 0.033, 0.024, -0.01, 0.028, P);
      b.box(0, 0, 0.037, 0.028, 0.028, 0.054, P);
      b.gable(0, 0, 0.037, 0.028, 0.054, 0.032, R, P);
      windows(b, 0, 0, 0.037, 0.028, 0.06, 0);
      break;
    }
  }
}

function tower(b: Builder, v: number): void {
  const S = PART.stone;
  const h = 0.14;
  const hw = 0.03;
  b.box(0, 0, hw, hw, -0.012, h, S);
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    b.plate(Math.sin(yaw) * hw, Math.cos(yaw) * hw, h * 0.55, h * 0.55 + 0.016, 0.003, yaw, PART.dark);
  }
  if (v === 1) {
    b.hip(0, 0, hw, hw, h, 0.05, PART.roof);
  } else {
    b.box(0, 0, hw + 0.004, hw + 0.004, h - 0.012, h, S);
    b.crenels(0, 0, hw + 0.004, hw + 0.004, h, 0.013, S);
  }
}

function roundTower(b: Builder, v: number): void {
  const S = PART.stone;
  const h = 0.135;
  const r = 0.033;
  const sides = b.segs + 2;
  b.cylinder(0, 0, r * 1.06, -0.012, 0.03, S, sides, r);
  b.cylinder(0, 0, r, 0.03, h, S, sides);
  for (const yaw of [0.4, 2.5, 4.4]) b.plate(Math.sin(yaw) * r, Math.cos(yaw) * r, h * 0.6, h * 0.6 + 0.015, 0.003, yaw, PART.dark);
  if (v === 1) {
    b.cylinder(0, 0, r + 0.004, h - 0.01, h, S, sides);
    b.ringCrenels(0, 0, r + 0.004, h, 0.013, S);
  } else {
    b.cone(0, 0, r + 0.008, h, v === 0 ? 0.065 : 0.05, PART.roof, sides);
  }
}

function gatehouse(b: Builder): void {
  // Road runs along local z; the wall runs along x.
  const S = PART.stone;
  const h = 0.13;
  const hz = 0.034;
  const pier = 0.024;
  const open = 0.033; // half opening (road half width ~0.055 with margin)
  for (const sx of [-1, 1]) {
    b.box(sx * (open + pier), 0, pier, hz, -0.012, h, S);
    b.crenels(sx * (open + pier), 0, pier, hz, h, 0.013, S);
  }
  // arch lintel and walk-way above the opening
  b.box(0, 0, open, hz, 0.075, h - 0.01, S, { bottom: true });
  b.box(0, 0, open + 0.004, hz * 0.9, h - 0.012, h - 0.004, PART.stoneDark);
}

function wallStairs(b: Builder): void {
  const n = 6;
  for (let i = 0; i < n; i++) {
    const x0 = -0.03 + (i * 0.06) / n;
    b.box(x0 + 0.005, 0, 0.005, 0.011, -0.005, 0.012 + ((i + 1) * (WALL_TOP - 0.02)) / n, PART.stone);
  }
}

function chapel(b: Builder): void {
  // cloister / abbey: nave, bell tower, arcade
  const P = PART.plaster;
  const R = PART.roof;
  b.box(-0.01, 0, 0.07, 0.045, -0.01, 0.06, P);
  b.gable(-0.01, 0, 0.07, 0.045, 0.06, 0.045, R, P);
  // arcade along the front (+z)
  for (let i = 0; i < 5; i++) {
    const x = -0.065 + i * 0.027;
    b.plate(x, 0.045, 0.0, 0.032, 0.0075, 0, PART.dark);
  }
  for (let i = 0; i < 4; i++) b.plate(-0.06 + i * 0.033, 0.045, 0.042, 0.052, 0.004, 0, PART.dark);
  // bell tower at +x
  b.box(0.075, 0, 0.026, 0.026, -0.01, 0.13, P);
  b.plate(0.075, 0.026, 0.095, 0.115, 0.008, 0, PART.dark);
  b.plate(0.101, 0, 0.095, 0.115, 0.008, Math.PI / 2, PART.dark);
  b.hip(0.075, 0, 0.026, 0.026, 0.13, 0.05, R, 0);
  // side wing (cloister range)
  b.box(-0.055, -0.07, 0.035, 0.025, -0.01, 0.04, P);
  b.gable(-0.055, -0.07, 0.035, 0.025, 0.04, 0.026, R, P);
}

function tree(b: Builder, v: number): void {
  b.cylinder(0, 0, 0.005, 0, 0.02, PART.trunk, 5);
  if (v === 0) {
    b.blob(0, 0.04, 0, 0.024, 1.05, PART.foliage, 1.3);
  } else {
    b.blob(0, 0.036, 0, 0.02, 1, PART.foliage, 2.1);
    b.blob(0.012, 0.05, 0.006, 0.016, 1, PART.foliage, 3.7);
  }
}

function bush(b: Builder, v: number): void {
  const F = PART.foliage;
  if (v === 0) b.blob(0, 0.008, 0, 0.0135, 0.85, F, 0.7);
  else if (v === 1) {
    b.blob(-0.006, 0.007, 0, 0.012, 0.85, F, 1.9);
    b.blob(0.008, 0.006, 0.004, 0.01, 0.8, F, 2.6);
  } else b.blob(0, 0.01, 0, 0.016, 0.9, F, 3.3);
}

function sheep(b: Builder): void {
  b.blob(0, 0.011, 0, 0.0085, 0.75, PART.sheep, 0.3);
  b.box(0, 0.011, 0.003, 0.0035, 0.008, 0.016, PART.dark);
  for (const [x, z] of [
    [-0.004, -0.004],
    [0.004, -0.004],
    [-0.004, 0.004],
    [0.004, 0.004],
  ] as const)
    b.box(x, z, 0.0012, 0.0012, 0, 0.006, PART.dark);
}

function cow(b: Builder): void {
  b.box(0, 0, 0.0065, 0.013, 0.007, 0.018, PART.cow);
  b.box(0, 0.016, 0.004, 0.004, 0.012, 0.02, PART.cow);
  for (const [x, z] of [
    [-0.004, -0.009],
    [0.004, -0.009],
    [-0.004, 0.009],
    [0.004, 0.009],
  ] as const)
    b.box(x, z, 0.0016, 0.0016, 0, 0.008, PART.dark);
}

function crop(b: Builder): void {
  // subtle crop strips: low furrows
  for (let i = 0; i < 4; i++) b.box(0, -0.018 + i * 0.012, 0.03, 0.0035, -0.002, 0.003, PART.crop);
}

function mill(b: Builder): void {
  b.box(0, 0, 0.03, 0.024, -0.01, 0.05, PART.plaster);
  b.gable(0, 0, 0.03, 0.024, 0.05, 0.03, PART.roof, PART.plaster);
  windows(b, 0, 0, 0.03, 0.024, 0.05, 0);
  // water wheel on the -x side, axis along x
  const wx = -0.036;
  const r = 0.026;
  const n = 10;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    b.box(wx, Math.cos(a) * r * 0.9, 0.006, 0.003, 0.025 + Math.sin(a) * r - 0.006, 0.025 + Math.sin(a) * r + 0.006, PART.wood);
  }
  b.box(wx, 0, 0.007, 0.004, 0.02, 0.03, PART.wood);
}

function fountain(b: Builder): void {
  b.cylinder(0, 0, 0.036, -0.004, 0.012, PART.stone, b.segs + 4);
  b.cylinder(0, 0, 0.03, 0.006, 0.0125, PART.water, b.segs + 4);
  b.cylinder(0, 0, 0.006, 0.01, 0.034, PART.stone, 6);
  b.cylinder(0, 0, 0.012, 0.03, 0.035, PART.stone, 8);
}

function duck(b: Builder): void {
  b.blob(0, 0.002, 0, 0.005, 0.6, PART.sheep, 0.1);
  b.blob(0, 0.006, 0.004, 0.0025, 1, PART.foliage, 0.2);
}

function cart(b: Builder): void {
  b.box(0, 0, 0.008, 0.014, 0.006, 0.014, PART.wood);
  for (const sx of [-1, 1]) b.box(sx * 0.0095, 0, 0.0015, 0.006, 0, 0.012, PART.dark);
  b.box(0, 0.02, 0.001, 0.008, 0.008, 0.01, PART.wood);
  b.blob(0, 0.016, -0.004, 0.006, 0.7, PART.crop, 0.5);
}

function bridge(b: Builder): void {
  // deck along local z (the road), parapets on both sides
  b.box(0, 0, 0.06, 0.1, -0.012, 0.004, PART.stone);
  for (const sx of [-1, 1]) b.box(sx * 0.056, 0, 0.005, 0.1, 0.004, 0.014, PART.stoneDark);
}

const BUILDERS: Record<PropKind, (b: Builder, v: number) => void> = {
  tower,
  house,
  chapel: (b) => chapel(b),
  tree,
  sheep: (b) => sheep(b),
  cow: (b) => cow(b),
  cart: (b) => cart(b),
  mill: (b) => mill(b),
  fountain: (b) => fountain(b),
  crop: (b) => crop(b),
  duck: (b) => duck(b),
  bridge: (b) => bridge(b),
  bush,
  gatehouse: (b) => gatehouse(b),
  round_tower: roundTower,
  wall_stairs: (b) => wallStairs(b),
};

/** Model scale on top of the authored sizes (houses are chunky, like the reference miniatures). */
const BASE_SCALE: Partial<Record<PropKind, number>> = { house: 1.3, mill: 1.2, sheep: 1.7, cow: 1.6, duck: 1.6, bush: 1.25, tree: 1.2 };

/** Builds prop models and caches them per (kit, prop, variant). */
export class PropKit {
  private cache = new Map<string, THREE.BufferGeometry>();
  constructor(readonly options: KitOptions) {}

  variantOf(prop: PropKind, variant: number): number {
    return variant % VARIANTS[prop];
  }

  geometry(prop: PropKind, variant: number): THREE.BufferGeometry {
    const v = this.variantOf(prop, variant);
    const key = `${prop}:${v}`;
    let g = this.cache.get(key);
    if (!g) {
      const b = new Builder(this.options.rounded);
      BUILDERS[prop](b, v);
      g = b.build();
      const k = BASE_SCALE[prop] ?? 1;
      if (k !== 1) {
        g.scale(k, k, k);
        g.computeBoundingSphere();
        g.computeBoundingBox();
      }
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
