// TEMPORARY procedural tile art from the port model, until @carcassonne/core-geo
// provides 2D paths. Works for any TileDef: cities become caps / bands / corners /
// three-sided walls, roads become curves, fields are found by flood-filling a grid
// around the cities and roads (so hover outlines match what is drawn).

import type { FeatureKind } from "@carcassonne/protocol";
import { featureSides, hasPort, type TileDef } from "@carcassonne/game-client";

import { TILE, type Pt, type TileArt, type TileArtFeature, type TileArtSource } from "./tile-art";

type P = [number, number];

const C: P = [50, 50];
/** End corner of each side, walking clockwise. */
const SIDE_END: P[] = [
  [100, 0],
  [100, 100],
  [0, 100],
  [0, 0],
];
const sideStart = (s: number): P => SIDE_END[(s + 3) % 4]!;
const sideEnd = (s: number): P => SIDE_END[s % 4]!;
const MID: P[] = [
  [50, 0],
  [100, 50],
  [50, 100],
  [0, 50],
];
const INWARD: P[] = [
  [0, 1],
  [-1, 0],
  [0, -1],
  [1, 0],
];

const add = (a: P, b: P, k = 1): P => [a[0] + b[0] * k, a[1] + b[1] * k];
const lerp = (a: P, b: P, t: number): P => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

function quad(p0: P, c: P, p1: P, n = 18): P[] {
  const out: P[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push([u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]]);
  }
  return out;
}

const fmt = (n: number) => (Math.round(n * 100) / 100).toString();
const polyPath = (pts: P[], close = true) =>
  pts.map((p, i) => `${i ? "L" : "M"}${fmt(p[0])} ${fmt(p[1])}`).join("") + (close ? "Z" : "");

function inPolygon([x, y]: P, poly: P[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distToPolyline(p: P, line: P[]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
    const q: P = [a[0] + dx * t, a[1] + dy * t];
    best = Math.min(best, Math.hypot(p[0] - q[0], p[1] - q[1]));
  }
  return best;
}

function pointAlong(line: P[], frac: number): P {
  let total = 0;
  for (let i = 1; i < line.length; i++) total += Math.hypot(line[i]![0] - line[i - 1]![0], line[i]![1] - line[i - 1]![1]);
  let want = total * frac;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (want <= d) return lerp(a, b, d ? want / d : 0);
    want -= d;
  }
  return line[line.length - 1]!;
}

function centroid(poly: P[]): P {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [x0, y0] = poly[j]!;
    const [x1, y1] = poly[i]!;
    const f = x0 * y1 - x1 * y0;
    a += f;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < 1e-6) return C;
  return [cx / (3 * a), cy / (3 * a)];
}

interface CityShape {
  poly: P[];
  walls: P[][];
}

function cityShape(sides: number[]): CityShape {
  const set = new Set(sides);
  if (set.size >= 4) return { poly: [[0, 0], [100, 0], [100, 100], [0, 100]], walls: [] };
  if (set.size === 1) {
    const s = sides[0]!;
    const curve = quad(sideEnd(s), add(MID[s]!, INWARD[s]!, 58), sideStart(s));
    return { poly: [sideStart(s), ...curve], walls: [curve] };
  }
  if (set.size === 3) {
    const m = [0, 1, 2, 3].find((s) => !set.has(s))!;
    const curve = quad(sideStart(m), add(MID[m]!, INWARD[m]!, 60), sideEnd(m));
    return { poly: [...curve, sideEnd(m + 1), sideEnd(m + 2)], walls: [curve] };
  }
  // Two sides.
  const [a, b] = sides as [number, number];
  if ((a + 2) % 4 === b) {
    const s = Math.min(a, b);
    const o = s + 2;
    const c1 = quad(sideEnd(s), add(MID[s + 1]!, INWARD[s + 1]!, 40), sideStart(o));
    const c2 = quad(sideEnd(o), add(MID[(o + 1) % 4]!, INWARD[(o + 1) % 4]!, 40), sideStart(s));
    return { poly: [sideStart(s), ...c1, ...c2], walls: [c1, c2] };
  }
  // Adjacent: order so that `first` is followed clockwise by `second`.
  const first = (a + 1) % 4 === b ? a : b;
  const corner = sideEnd(first);
  const far = sideEnd(first + 1);
  const curve = quad(far, lerp(C, corner, 0.62), sideStart(first));
  return { poly: [sideStart(first), corner, ...curve], walls: [curve] };
}

function roadLine(sides: number[], toCentre: P = C): P[] {
  if (sides.length >= 2) {
    const [a, b] = sides as [number, number];
    if ((a + 2) % 4 === b) return [MID[a]!, MID[b]!];
    return quad(MID[a]!, C, MID[b]!);
  }
  return [MID[sides[0]!]!, toCentre];
}

const GRID = 40;
const CELL = TILE / GRID;
const ROAD_HALF = 5.5;

/** Fraction ranges of a side's three ports (narrow middle when it carries a road). */
function portRange(k: number, narrowMid: boolean): [number, number] {
  const cuts = narrowMid ? [0, 0.44, 0.56, 1] : [0, 1 / 3, 2 / 3, 1];
  return [cuts[k]!, cuts[k + 1]!];
}

function edgeCells(port: number, narrowMid: boolean): [number, number][] {
  const side = Math.floor(port / 3);
  const [t0, t1] = portRange(port % 3, narrowMid);
  const out: [number, number][] = [];
  for (let i = 0; i < GRID; i++) {
    const t = (i + 0.5) / GRID;
    if (t < t0 || t > t1) continue;
    switch (side) {
      case 0:
        out.push([i, 0]);
        break;
      case 1:
        out.push([GRID - 1, i]);
        break;
      case 2:
        out.push([GRID - 1 - i, GRID - 1]);
        break;
      default:
        out.push([0, GRID - 1 - i]);
    }
  }
  return out;
}

function cellsPath(cells: Set<number>): string {
  let d = "";
  for (let y = 0; y < GRID; y++) {
    let x = 0;
    while (x < GRID) {
      if (!cells.has(y * GRID + x)) {
        x++;
        continue;
      }
      const start = x;
      while (x < GRID && cells.has(y * GRID + x)) x++;
      d += `M${fmt(start * CELL)} ${fmt(y * CELL)}h${fmt((x - start) * CELL)}v${fmt(CELL)}h${fmt(-(x - start) * CELL)}Z`;
    }
  }
  return d;
}

function cellsAnchor(cells: Set<number>): P {
  let sx = 0;
  let sy = 0;
  for (const c of cells) {
    sx += (c % GRID) + 0.5;
    sy += Math.floor(c / GRID) + 0.5;
  }
  const cx = sx / cells.size;
  const cy = sy / cells.size;
  // Prefer interior cells (all neighbours within radius 3 in the region).
  const interior = (c: number) => {
    const x = c % GRID;
    const y = Math.floor(c / GRID);
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -3; dx <= 3; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) continue;
        if (!cells.has(ny * GRID + nx)) return false;
      }
    return true;
  };
  let best = -1;
  let bestD = Infinity;
  for (const pass of [true, false]) {
    for (const c of cells) {
      if (pass && !interior(c)) continue;
      const d = Math.hypot((c % GRID) + 0.5 - cx, Math.floor(c / GRID) + 0.5 - cy);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (best >= 0) break;
  }
  return [((best % GRID) + 0.5) * CELL, (Math.floor(best / GRID) + 0.5) * CELL];
}

function pennantSpots(poly: P[], anchor: P, n: number): P[] {
  const offsets: P[] = [
    [-20, -16],
    [20, -16],
    [-20, 16],
    [20, 16],
    [0, -22],
    [0, 22],
    [-24, 0],
    [24, 0],
    [-12, -10],
    [12, -10],
  ];
  const out: P[] = [];
  for (const o of offsets) {
    if (out.length >= n) break;
    const p = add(anchor, o);
    const ok = [p, add(p, [6, 6]), add(p, [-6, -6]), add(p, [6, -6]), add(p, [-6, 6])].every(
      (q) => q[0] > 2 && q[0] < 98 && q[1] > 2 && q[1] < 98 && inPolygon(q, poly),
    );
    if (ok) out.push(p);
  }
  while (out.length < n) out.push(add(anchor, [10, -10]));
  return out;
}

export function buildProceduralArt(def: TileDef): TileArt {
  const features: TileArtFeature[] = def.features.map((f, index) => ({
    index,
    kind: f.kind,
    anchor: C,
    pennants: [],
  }));
  const cities: { poly: P[]; index: number }[] = [];
  const lines: { line: P[]; index: number; kind: FeatureKind }[] = [];
  const singleRoads = def.features.filter((f) => (f.kind === "road" || f.kind === "river") && featureSides(f).length === 1);
  const hasCloister = def.features.some((f) => f.kind === "cloister");

  def.features.forEach((f, i) => {
    const out = features[i]!;
    const sides = featureSides(f);
    if (f.kind === "city") {
      const shape = cityShape(sides);
      cities.push({ poly: shape.poly, index: i });
      out.area = polyPath(shape.poly);
      out.walls = shape.walls.map((w) => polyPath(w, false)).join("");
      const c = centroid(shape.poly);
      out.anchor = sides.length === 4 ? [50, 56] : c;
      out.pennants = pennantSpots(shape.poly, out.anchor as P, f.pennants ?? 0);
    } else if (f.kind === "road" || f.kind === "river") {
      const end: P = sides.length === 1 && hasCloister ? [50, 58] : C;
      const line = roadLine(sides, end);
      lines.push({ line, index: i, kind: f.kind });
      out.line = polyPath(line, false);
      out.anchor = sides.length === 1 ? pointAlong(line, singleRoads.length >= 3 ? 0.45 : 0.4) : pointAlong(line, 0.5);
    } else if (f.kind === "cloister") {
      out.area = "M32 30h36v40h-36Z";
      out.anchor = [50, 54];
    } else if (f.kind === "garden") {
      out.area = "M62 62h26v26h-26Z";
      out.anchor = [75, 75];
    }
  });

  // Fields: flood fill the grid around cities and roads.
  const narrow = [0, 1, 2, 3].map((s) =>
    def.features.some((f) => (f.kind === "road" || f.kind === "river") && hasPort(f.ports, s * 3 + 1)),
  );
  const blocked = new Uint8Array(GRID * GRID);
  for (let y = 0; y < GRID; y++)
    for (let x = 0; x < GRID; x++) {
      const p: P = [(x + 0.5) * CELL, (y + 0.5) * CELL];
      if (cities.some((c) => inPolygon(p, c.poly)) || lines.some((l) => distToPolyline(p, l.line) < ROAD_HALF))
        blocked[y * GRID + x] = 1;
    }
  const comp = new Int32Array(GRID * GRID).fill(-1);
  let ncomp = 0;
  for (let i = 0; i < GRID * GRID; i++) {
    if (blocked[i] || comp[i]! >= 0) continue;
    const stack = [i];
    comp[i] = ncomp;
    while (stack.length) {
      const c = stack.pop()!;
      const x = c % GRID;
      const y = Math.floor(c / GRID);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) continue;
        const n = ny * GRID + nx;
        if (blocked[n] || comp[n]! >= 0) continue;
        comp[n] = ncomp;
        stack.push(n);
      }
    }
    ncomp++;
  }
  def.features.forEach((f, i) => {
    if (f.kind !== "field") return;
    const comps = new Set<number>();
    for (let port = 0; port < 12; port++) {
      if (!hasPort(f.ports, port)) continue;
      for (const [x, y] of edgeCells(port, narrow[Math.floor(port / 3)]!)) {
        const c = comp[y * GRID + x]!;
        if (c >= 0) comps.add(c);
      }
    }
    const cells = new Set<number>();
    for (let c = 0; c < GRID * GRID; c++) if (comps.has(comp[c]!)) cells.add(c);
    const out = features[i]!;
    if (!cells.size) return;
    out.area = cellsPath(cells);
    out.anchor = cellsAnchor(cells);
  });

  const villages: Pt[] = singleRoads.length >= 3 ? [C] : [];
  return { id: def.id, features, villages };
}

/** Default art source: procedural drawing from the port model, cached per tile id. */
export function createProceduralArt(): TileArtSource {
  const cache = new Map<string, TileArt>();
  return {
    name: "procedural",
    get(def) {
      let art = cache.get(def.id);
      if (!art) {
        art = buildProceduralArt(def);
        cache.set(def.id, art);
      }
      return art;
    },
  };
}

export const proceduralArt = createProceduralArt();
