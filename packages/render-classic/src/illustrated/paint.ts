// The painted Classic tile: core-geo regions as the layout, drawn like the printed
// tiles. Ground (grass, roads, river, city ground) is top-down; everything standing
// (houses, towers, walls, the chapel, trees) is drawn in a slight oblique view with
// its front toward the bottom of the screen and shadows falling to the bottom-right,
// so every rotation is lit the same way. All randomness is seeded by the tile id.

import type { IllustratedPalette } from "../palette";
import { css, mix, parseColor, rng, shade } from "./noise";
import { texturesFor, type TextureSet } from "./textures";
import type { Ctx2D, IllPath, IllProp, IllustratedTile } from "./types";

type Pt = [number, number];

/** Screen-up shift per unit of height (oblique view). */
const OB = 0.78;
/** Shadow offset per unit of height (light from the top-left). */
const SX = 0.55;
const SY = 0.42;
/** Light direction for faces: towards the top-left and up. */
const L3 = (() => {
  const v = [-0.55, -0.62, 0.62];
  const n = Math.hypot(v[0]!, v[1]!, v[2]!);
  return v.map((x) => x / n) as [number, number, number];
})();

const TAU = Math.PI * 2;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

function rot100([x, y]: Pt, rot: number): Pt {
  switch (((rot % 4) + 4) % 4) {
    case 1:
      return [100 - y, x];
    case 2:
      return [100 - x, 100 - y];
    case 3:
      return [y, 100 - x];
    default:
      return [x, y];
  }
}

interface RPath extends IllPath {
  P: Pt[];
}

interface RProp extends IllProp {
  /** Screen position in tile units (0..100), after rotation. */
  sx: number;
  sy: number;
  /** Screen angle of the prop's local +x axis. */
  phi: number;
}

function onBorder(a: Pt, b: Pt): boolean {
  const e = 0.6;
  return (
    (Math.abs(a[0]) < e && Math.abs(b[0]) < e) ||
    (Math.abs(a[0] - 100) < e && Math.abs(b[0] - 100) < e) ||
    (Math.abs(a[1]) < e && Math.abs(b[1]) < e) ||
    (Math.abs(a[1] - 100) < e && Math.abs(b[1] - 100) < e)
  );
}

function polyPath(ctx: Ctx2D, P: Pt[], closed: boolean, dx = 0, dy = 0) {
  P.forEach(([x, y], i) => (i ? ctx.lineTo(x + dx, y + dy) : ctx.moveTo(x + dx, y + dy)));
  if (closed) ctx.closePath();
}

function signedArea(P: Pt[]): number {
  let a = 0;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) a += (P[j]![0] - P[i]![0]) * (P[j]![1] + P[i]![1]);
  return a / 2;
}

/**
 * Path of a closed polygon's edges that are not on the tile border (so strokes never
 * draw a line across a seam). With `union`, edges inside the union (shared by two
 * overlapping regions, e.g. a pond and its river band) are skipped too.
 */
function openEdges(ctx: Ctx2D, P: Pt[], union?: Pt[][]) {
  for (let i = 0; i < P.length; i++) {
    const a = P[i]!;
    const b = P[(i + 1) % P.length]!;
    if (onBorder(a, b)) continue;
    if (union && union.length > 1) {
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const nx = (-(b[1] - a[1]) / l) * 1.2;
      const ny = ((b[0] - a[0]) / l) * 1.2;
      const m: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const inA = union.some((q) => inPoly([m[0] + nx, m[1] + ny], q));
      const inB = union.some((q) => inPoly([m[0] - nx, m[1] - ny], q));
      if (inA && inB) continue;
    }
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
  }
}

function inPoly([x, y]: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const nearBorder = ([x, y]: Pt, e = 0.8) => x < e || y < e || x > 100 - e || y > 100 - e;

/** Extend polyline ends that touch the tile border outwards, so raised (shifted) strokes still reach the seam. */
function extendEnds(P: Pt[], by: number): Pt[] {
  if (P.length < 2) return P;
  const out = P.slice();
  const ext = (a: Pt, b: Pt): Pt => {
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];
    const l = Math.hypot(dx, dy) || 1;
    return [a[0] + (dx / l) * by, a[1] + (dy / l) * by];
  };
  if (nearBorder(P[0]!)) out.unshift(ext(P[0]!, P[1]!));
  if (nearBorder(P[P.length - 1]!)) out.push(ext(P[P.length - 1]!, P[P.length - 2]!));
  return out;
}

/** Offset a polyline sideways by d (positive = left normal in screen space). */
function offsetLine(P: Pt[], d: number): Pt[] {
  return P.map((p, i) => {
    const a = P[Math.max(0, i - 1)]!;
    const b = P[Math.min(P.length - 1, i + 1)]!;
    let nx = -(b[1] - a[1]);
    let ny = b[0] - a[0];
    const l = Math.hypot(nx, ny) || 1;
    nx /= l;
    ny /= l;
    return [p[0] + nx * d, p[1] + ny * d];
  });
}

// ── oblique primitives ──────────────────────────────────────────────────────

/** Project prop-local (lx along local x, lz along local z, h up) to the screen. */
function projector(p: { sx: number; sy: number; phi: number }) {
  const c = Math.cos(p.phi);
  const s = Math.sin(p.phi);
  return (lx: number, lz: number, h = 0): Pt => [p.sx + lx * c - lz * s, p.sy + lx * s + lz * c - h * OB];
}

/** Brightness (0..1) of a face with screen-outward horizontal normal (nx, ny) tilted by `slope` from vertical. */
function lightOf(nx: number, ny: number, slope: number): number {
  const sh = Math.sin(slope);
  const ch = Math.cos(slope);
  const d = nx * sh * L3[0] + ny * sh * L3[1] + ch * L3[2];
  return clamp01((d + 0.15) / 1.05);
}

function fillPoly(ctx: Ctx2D, P: Pt[], fill: string, stroke?: string, lw = 0.2) {
  ctx.beginPath();
  polyPath(ctx, P, true);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
}

interface BoxStyle {
  light: string;
  base: string;
  shade: string;
  top?: string;
  outline: string;
}

/** Walls of an oblique box (local half sizes hx, hz; height h). Returns the top corners. */
function boxWalls(ctx: Ctx2D, pr: ReturnType<typeof projector>, hx: number, hz: number, h: number, st: BoxStyle, k: number, windows?: { color: string; door?: boolean }): Pt[] {
  const corners: Pt[] = [
    [-hx, -hz],
    [hx, -hz],
    [hx, hz],
    [-hx, hz],
  ];
  const g = corners.map(([x, z]) => pr(x, z, 0));
  const t = corners.map(([x, z]) => pr(x, z, h));
  for (let i = 0; i < 4; i++) {
    const a = g[i]!;
    const b = g[(i + 1) % 4]!;
    // Outward normal of edge a→b (corners run clockwise on screen).
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const len = Math.hypot(ex, ey) || 1;
    const nx = ey / len;
    const ny = -ex / len;
    if (ny <= 0.02) continue;
    const lit = lightOf(nx, ny, Math.PI / 2);
    const col = lit > 0.5 ? mix(st.base, st.light, (lit - 0.5) * 2) : mix(st.shade, st.base, lit * 2);
    fillPoly(ctx, [a, b, t[(i + 1) % 4]!, t[i]!], col, st.outline, 0.16);
    if (windows && len > 1.6 && k > 1.4) {
      const n = len > 4.5 ? 3 : len > 2.8 ? 2 : 1;
      ctx.fillStyle = windows.color;
      for (let w = 0; w < n; w++) {
        const f = (w + 1) / (n + 1);
        const wx = a[0] + ex * f;
        const wy = a[1] + ey * f;
        const door = windows.door && w === Math.floor(n / 2) && ny > 0.6;
        const ww = 0.42;
        const wh = door ? h * 0.55 : h * 0.26;
        const base = door ? 0 : h * 0.42;
        ctx.beginPath();
        ctx.moveTo(wx - (ex / len) * ww, wy - (ey / len) * ww - base * OB);
        ctx.lineTo(wx + (ex / len) * ww, wy + (ey / len) * ww - base * OB);
        ctx.lineTo(wx + (ex / len) * ww, wy + (ey / len) * ww - (base + wh) * OB);
        ctx.lineTo(wx - (ex / len) * ww, wy - (ey / len) * ww - (base + wh) * OB);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
  return t;
}

/** Gabled (or hipped) roof over a box; ridge along local x. */
function roof(
  ctx: Ctx2D,
  pr: ReturnType<typeof projector>,
  hx: number,
  hz: number,
  h: number,
  rise: number,
  colors: [string, string],
  wallSt: BoxStyle,
  opts: { hipped?: boolean; outline: string; k: number; overhang?: number },
) {
  const o = opts.overhang ?? 0.3;
  const ax = hx + o;
  const az = hz + o;
  const rx = opts.hipped ? Math.max(0.25, hx - hz * 0.9) : ax;
  const ridgeA = pr(-rx, 0, h + rise);
  const ridgeB = pr(rx, 0, h + rise);
  type Face = { P: Pt[]; nx: number; ny: number; wall?: boolean };
  const faces: Face[] = [];
  const slope = Math.atan2(rise * 1.6, az);
  const dirOf = (lx: number, lz: number): [number, number] => {
    const a = pr(0, 0);
    const b = pr(lx, lz);
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  };
  const [n1x, n1y] = dirOf(0, 1);
  const [n2x, n2y] = dirOf(0, -1);
  faces.push({ P: [pr(-ax, az, h), pr(ax, az, h), ridgeB, ridgeA], nx: n1x, ny: n1y });
  faces.push({ P: [pr(ax, -az, h), pr(-ax, -az, h), ridgeA, ridgeB], nx: n2x, ny: n2y });
  const [e1x, e1y] = dirOf(1, 0);
  const [e2x, e2y] = dirOf(-1, 0);
  if (opts.hipped) {
    faces.push({ P: [pr(ax, az, h), pr(ax, -az, h), ridgeB], nx: e1x, ny: e1y });
    faces.push({ P: [pr(-ax, -az, h), pr(-ax, az, h), ridgeA], nx: e2x, ny: e2y });
  } else {
    // Gable ends are wall-coloured triangles (only the ones facing the viewer show).
    if (e1y > 0.02) faces.push({ P: [pr(hx, hz, h), pr(hx, -hz, h), pr(hx, 0, h + rise)], nx: e1x, ny: e1y, wall: true });
    if (e2y > 0.02) faces.push({ P: [pr(-hx, -hz, h), pr(-hx, hz, h), pr(-hx, 0, h + rise)], nx: e2x, ny: e2y, wall: true });
  }
  // Back faces first.
  faces.sort((a, b) => a.ny - b.ny);
  for (const f of faces) {
    if (f.wall) {
      const lit = lightOf(f.nx, f.ny, Math.PI / 2);
      fillPoly(ctx, f.P, lit > 0.5 ? mix(wallSt.base, wallSt.light, (lit - 0.5) * 2) : mix(wallSt.shade, wallSt.base, lit * 2), wallSt.outline, 0.16);
      continue;
    }
    const lit = lightOf(f.nx, f.ny, slope);
    const col = mix(colors[1], colors[0], lit);
    fillPoly(ctx, f.P, col, opts.outline, 0.2);
    if (opts.k > 1.8) {
      // Tile courses parallel to the eave.
      ctx.strokeStyle = css(parseColor(colors[1]), 0.35);
      ctx.lineWidth = 0.12;
      ctx.beginPath();
      const [a, b] = [f.P[0]!, f.P[1]!];
      const top = f.P.length === 4 ? [f.P[3]!, f.P[2]!] : [f.P[2]!, f.P[2]!];
      for (const t of [0.33, 0.66]) {
        ctx.moveTo(a[0] + (top[0]![0] - a[0]) * t, a[1] + (top[0]![1] - a[1]) * t);
        ctx.lineTo(b[0] + (top[1]![0] - b[0]) * t, b[1] + (top[1]![1] - b[1]) * t);
      }
      ctx.stroke();
    }
  }
  // Ridge line.
  ctx.strokeStyle = shade(colors[1], -0.25);
  ctx.lineWidth = 0.28;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(ridgeA[0], ridgeA[1]);
  ctx.lineTo(ridgeB[0], ridgeB[1]);
  ctx.stroke();
}

/** Pyramid or cone cap (tower roofs). */
function cap(ctx: Ctx2D, cx: number, cy: number, r: number, h: number, colors: [string, string], outline: string, round: boolean) {
  const apex: Pt = [cx, cy - h * OB];
  const n = round ? 10 : 4;
  const base: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = round ? (i / n) * TAU : Math.PI / 4 + (i / n) * TAU;
    base.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.62]);
  }
  const faces = base.map((p, i) => {
    const q = base[(i + 1) % n]!;
    const mx = (p[0] + q[0]) / 2 - cx;
    const my = (p[1] + q[1]) / 2 - cy;
    const l = Math.hypot(mx, my) || 1;
    return { P: [p, q, apex] as Pt[], nx: mx / l, ny: my / l };
  });
  faces.sort((a, b) => a.ny - b.ny);
  for (const f of faces) fillPoly(ctx, f.P, mix(colors[1], colors[0], lightOf(f.nx, f.ny, 0.9)), round ? undefined : outline, 0.18);
  if (round) {
    ctx.beginPath();
    base.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.lineTo(apex[0], apex[1]);
    ctx.closePath();
  }
}

// ── the painter ────────────────────────────────────────────────────────────

export interface PaintOptions {
  tile: IllustratedTile;
  rot: number;
  palette: IllustratedPalette;
  paletteId: string;
  /** Output size in pixels (square). */
  size: number;
  /** Prebuilt textures (defaults to the shared cache). */
  textures?: TextureSet;
}

export function paintTile(ctx: Ctx2D, o: PaintOptions) {
  const { tile, palette: pal, size } = o;
  const rot = ((o.rot % 4) + 4) % 4;
  const tex = o.textures ?? texturesFor(o.paletteId, pal, size);
  const k = size / 100;
  const R = rng(tile.seed ^ 0x5bd1e995);
  const paths: RPath[] = tile.paths.map((p) => {
    const P: Pt[] = [];
    for (let i = 0; i + 1 < p.pts.length; i += 2) P.push(rot100([p.pts[i]! * 100, p.pts[i + 1]! * 100], rot));
    // One winding for every closed polygon, so unions of overlapping regions fill (nonzero) without holes.
    if (p.closed && signedArea(P) < 0) P.reverse();
    return { ...p, P };
  });
  const small = size <= 160;
  // Thin out the field scatter: the printed tiles show a few trees, not an orchard.
  const keep = rng(tile.seed ^ 0x2545f491);
  const KEEP: Record<string, number> = { tree: 0.42, crop: 0.4, sheep: 0.7, cow: 0.6 };
  const props: RProp[] = tile.props.flatMap((p) => {
    const roll = keep();
    const sz = keep();
    if (roll > (KEEP[p.prop] ?? 1)) return [];
    // Small bitmaps: fewer, larger houses so the town still reads as roofs on tan ground.
    const city = p.prop === "house" && tile.features[p.feature] === "city";
    if (city && small && roll > 0.74) return [];
    const [sx, sy] = rot100([p.x * 100, p.y * 100], rot);
    const village = p.prop === "house" && tile.features[p.feature] !== "city";
    const scale = p.prop === "tree" ? p.scale * (0.85 + sz * 0.55) : village ? p.scale * 1.5 : city && small ? p.scale * 1.12 : p.scale;
    return [{ ...p, scale, sx, sy, phi: -p.yaw + (rot * Math.PI) / 2 }];
  });
  const regions = (kind: string) => paths.filter((p) => p.role === "region" && p.kind === kind);
  const fields = regions("field");
  const cities = regions("city");
  const rivers = regions("river");
  const roads = paths.filter((p) => p.kind === "road" && (p.role === "region" || p.role === "plaza"));
  const walls = paths.filter((p) => p.role === "wall");
  const buildings = paths.filter((p) => p.role === "building");
  const plazas = paths.filter((p) => p.role === "plaza");
  const lines = paths.filter((p) => p.role === "centerline");

  const pattern = (img: CanvasImageSource) => {
    const pat = ctx.createPattern(img, "repeat")!;
    if (typeof DOMMatrix !== "undefined") pat.setTransform(new DOMMatrix([1 / k, 0, 0, 1 / k, 0, 0]));
    return pat;
  };

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, size, size);
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.beginPath();
  ctx.rect(0, 0, 100, 100);
  ctx.clip();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // 1. Grass everywhere (fields partition the rest).
  ctx.drawImage(tex.grass as CanvasImageSource, 0, 0, 100, 100);
  // Per-tile tonal variation that fades out before the edges, so seams still match.
  for (let i = 0; i < 5; i++) {
    const cx = 28 + R() * 44;
    const cy = 28 + R() * 44;
    const r = 10 + R() * 14;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    const col = R() < 0.5 ? pal.grass.dark : pal.grass.light;
    g.addColorStop(0, mix(col, col, 0, 0.16));
    g.addColorStop(1, mix(col, col, 0, 0));
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  // Flowers in the fields.
  const flowerCount = 8 + Math.floor(R() * 10);
  for (let i = 0, tries = 0; i < flowerCount && tries < 200; tries++) {
    const p: Pt = [3 + R() * 94, 3 + R() * 94];
    if (!fields.some((f) => inPoly(p, f.P))) continue;
    i++;
    const col = pal.grass.flowers[Math.floor(R() * pal.grass.flowers.length)]!;
    const n = 2 + Math.floor(R() * 3);
    for (let j = 0; j < n; j++) {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(p[0] + (R() - 0.5) * 2.2, p[1] + (R() - 0.5) * 1.6, 0.28 + R() * 0.12, 0, TAU);
      ctx.fill();
    }
  }
  // Crop patches lie on the ground.
  for (const p of props) if (p.prop === "crop") drawCrop(ctx, p, pal);

  // 2. River and ponds.
  if (rivers.length) {
    ctx.beginPath();
    for (const r of rivers) openEdges(ctx, r.P, rivers.map((q) => q.P));
    ctx.strokeStyle = css(parseColor(pal.water.bank), 0.75);
    ctx.lineWidth = 2.4;
    ctx.stroke();
    ctx.beginPath();
    for (const r of rivers) polyPath(ctx, r.P, true);
    ctx.fillStyle = pattern(tex.water as CanvasImageSource);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    for (const r of rivers) polyPath(ctx, r.P, true);
    ctx.clip();
    // Darker edges, lighter centre, a few ripples.
    ctx.beginPath();
    for (const r of rivers) openEdges(ctx, r.P, rivers.map((q) => q.P));
    ctx.strokeStyle = css(parseColor(pal.water.deep), 0.7);
    ctx.lineWidth = 3.2;
    ctx.stroke();
    for (const l of lines.filter((l) => l.kind === "river")) {
      const w = l.width * 100;
      ctx.beginPath();
      polyPath(ctx, l.P, false);
      ctx.lineCap = "butt";
      ctx.strokeStyle = css(parseColor(pal.water.light), 0.55);
      ctx.lineWidth = w * 0.42;
      ctx.stroke();
      ctx.lineCap = "round";
      for (const [off, dash, a] of [
        [-w * 0.24, [1.6, 3.4, 0.8, 5.2], 0.6],
        [-w * 0.05, [0.9, 6.1, 2.2, 4.4], 0.5],
        [w * 0.16, [1.3, 4.6, 0.7, 6.3], 0.55],
      ] as const) {
        ctx.beginPath();
        polyPath(ctx, offsetLine(l.P, off), false);
        ctx.setLineDash(dash as unknown as number[]);
        ctx.lineDashOffset = R() * 9;
        ctx.strokeStyle = css(parseColor(pal.water.ripple), a);
        ctx.lineWidth = 0.38;
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    if (tile.special === "spring" || tile.special === "lake") {
      for (const r of rivers) {
        const c = centroid(r.P);
        const g = ctx.createRadialGradient(c[0] - 2, c[1] - 2, 0, c[0], c[1], 16);
        g.addColorStop(0, css(parseColor(pal.water.ripple), 0.55));
        g.addColorStop(1, css(parseColor(pal.water.ripple), 0));
        ctx.fillStyle = g;
        ctx.fillRect(c[0] - 18, c[1] - 18, 36, 36);
      }
    }
    ctx.restore();
  }

  // 3. Roads: a thin darker edge, cream sand, a lighter worn centre.
  if (roads.length) {
    ctx.beginPath();
    for (const r of roads) openEdges(ctx, r.P, roads.map((q) => q.P));
    ctx.strokeStyle = pal.road.edge;
    ctx.lineWidth = 1.3;
    ctx.stroke();
    ctx.beginPath();
    for (const r of roads) polyPath(ctx, r.P, true);
    ctx.fillStyle = pattern(tex.sand as CanvasImageSource);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    for (const r of roads) polyPath(ctx, r.P, true);
    ctx.clip();
    ctx.beginPath();
    for (const r of roads) openEdges(ctx, r.P, roads.map((q) => q.P));
    ctx.strokeStyle = css(parseColor(pal.road.rut), 0.8);
    ctx.lineWidth = 2.2;
    ctx.stroke();
    ctx.beginPath();
    for (const l of lines.filter((l) => l.kind === "road")) polyPath(ctx, l.P, false);
    ctx.lineCap = "butt";
    ctx.strokeStyle = css(parseColor(pal.road.light), 0.7);
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.lineCap = "round";
    ctx.restore();
  }
  for (const p of props) if (p.prop === "bridge") drawBridge(ctx, p, pal);

  // 4. City ground, darkened along the inside of the walls.
  if (cities.length) {
    ctx.save();
    ctx.beginPath();
    for (const c of cities) polyPath(ctx, c.P, true);
    ctx.fillStyle = pattern(tex.ground as CanvasImageSource);
    ctx.fill();
    ctx.clip();
    for (const [w, a] of [
      [11, 0.12],
      [6, 0.16],
    ] as const) {
      ctx.beginPath();
      for (const wl of walls) polyPath(ctx, extendEnds(wl.P, 3), false);
      ctx.strokeStyle = css(parseColor(pal.ground.speck), a);
      ctx.lineWidth = w;
      ctx.stroke();
    }
    ctx.restore();
  }

  // 5. Cloister courtyards and gardens (ground level).
  for (const b of buildings) {
    if (b.kind === "garden") drawGardenGround(ctx, b.P, pal, R);
    else drawCourtyard(ctx, b.P, pal);
  }
  for (const pl of plazas) drawWell(ctx, centroid(pl.P), pal, k);

  // 6. Wall runs, split into back (city to the south: drawn before the houses) and
  //    front (city to the north: its face toward the viewer, drawn after).
  // Small bitmaps (zoomed-out boards, thumbnails) get bolder walls and shields so cities still read.
  const bold = o.size <= 160 ? 1.35 : 1;
  const W = 3.4 * bold;
  const WH = 2.6;
  const runs = wallRuns(walls, cities);

  // 7. Shadows of everything standing, in one soft pass.
  ctx.save();
  if ("filter" in ctx) ctx.filter = `blur(${Math.max(0.5, k * 0.55).toFixed(2)}px)`;
  ctx.fillStyle = pal.shadow;
  ctx.beginPath();
  for (const p of props) shadowOf(ctx, p);
  ctx.fill();
  ctx.beginPath();
  for (const r of runs) polyPath(ctx, r.P, false, SX * WH * 1.1, SY * WH * 1.1);
  ctx.strokeStyle = pal.shadow;
  ctx.lineWidth = W;
  ctx.stroke();
  ctx.restore();

  for (const r of runs) if (!r.front) drawWall(ctx, r, pal, W, WH);

  // 8. Standing things, back to front.
  const order = props.filter((p) => !["crop", "bridge", "tower", "round_tower", "gatehouse", "wall_stairs"].includes(p.prop)).sort((a, b) => a.sy - b.sy);
  for (const p of order) drawProp(ctx, p, pal, k);

  for (const r of runs) if (r.front) drawWall(ctx, r, pal, W, WH);
  const towers = props.filter((p) => p.prop === "tower" || p.prop === "round_tower" || p.prop === "gatehouse").sort((a, b) => a.sy - b.sy);
  for (const p of towers) drawProp(ctx, p, pal, k);

  // 9. Pennants (coats of arms) on the city ground.
  for (const pn of tile.pennants) {
    const [x, y] = rot100([pn.x * 100, pn.y * 100], rot);
    drawPennant(ctx, x, y, pal, bold * 1.15);
  }

  // 10. Paper grain and a subtle bevel at the tile edge.
  ctx.save();
  ctx.globalCompositeOperation = "soft-light";
  ctx.globalAlpha = 0.55;
  ctx.drawImage(tex.grain as CanvasImageSource, 0, 0, 100, 100);
  ctx.restore();
  bevel(ctx, pal);
  ctx.restore();
}

function centroid(P: Pt[]): Pt {
  let x = 0;
  let y = 0;
  for (const p of P) {
    x += p[0];
    y += p[1];
  }
  return [x / P.length, y / P.length];
}

interface WallRun {
  P: Pt[];
  front: boolean;
  /** Sign of the outer side relative to the polyline's left normal. */
  outer: number;
}

function wallRuns(walls: RPath[], cities: RPath[]): WallRun[] {
  const out: WallRun[] = [];
  for (const w of walls) {
    const P = extendEnds(w.P, 6);
    const city = cities.filter((c) => c.feature === w.feature);
    const polys = city.length ? city : cities;
    // City side of each segment.
    const seg: { front: boolean; outer: number }[] = [];
    for (let i = 0; i + 1 < P.length; i++) {
      const a = P[i]!;
      const b = P[i + 1]!;
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const nx = -(b[1] - a[1]) / l;
      const ny = (b[0] - a[0]) / l;
      const m: Pt = [(a[0] + b[0]) / 2 + nx * 2.5, (a[1] + b[1]) / 2 + ny * 2.5];
      const left = polys.some((c) => inPoly(m, c.P));
      const cy = left ? ny : -ny;
      seg.push({ front: cy < -0.15, outer: left ? -1 : 1 });
    }
    let start = 0;
    for (let i = 1; i <= seg.length; i++) {
      if (i === seg.length || seg[i]!.front !== seg[start]!.front) {
        out.push({ P: P.slice(start, i + 1), front: seg[start]!.front, outer: seg[start]!.outer });
        start = i;
      }
    }
  }
  return out;
}

function drawWall(ctx: Ctx2D, r: WallRun, pal: IllustratedPalette, W: number, H: number) {
  const w = pal.wall;
  ctx.save();
  ctx.lineCap = "butt";
  ctx.lineJoin = "round";
  // Face: sweep the band from the ground up to the top.
  ctx.beginPath();
  polyPath(ctx, r.P, false);
  ctx.strokeStyle = w.outline;
  ctx.lineWidth = W + 0.5;
  ctx.stroke();
  const steps = 6;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    ctx.beginPath();
    polyPath(ctx, r.P, false, 0, -t * H * OB);
    ctx.strokeStyle = mix(w.faceDark, w.face, t);
    ctx.lineWidth = W;
    ctx.stroke();
  }
  // Mortar courses on the face.
  ctx.beginPath();
  polyPath(ctx, r.P, false, 0, -H * OB * 0.45);
  ctx.setLineDash([0.9, 0.7]);
  ctx.strokeStyle = css(parseColor(w.tick), 0.6);
  ctx.lineWidth = W * 0.85;
  ctx.globalAlpha = 0.35;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  // Top walkway.
  const top = r.P.map(([x, y]) => [x, y - H * OB] as Pt);
  ctx.beginPath();
  polyPath(ctx, top, false);
  ctx.strokeStyle = w.outline;
  ctx.lineWidth = W * 0.78 + 0.4;
  ctx.stroke();
  ctx.beginPath();
  polyPath(ctx, top, false);
  ctx.strokeStyle = w.top;
  ctx.lineWidth = W * 0.78;
  ctx.stroke();
  ctx.beginPath();
  polyPath(ctx, offsetLine(top, -r.outer * W * 0.18), false);
  ctx.strokeStyle = w.topLight;
  ctx.lineWidth = W * 0.22;
  ctx.stroke();
  // Crenellations along the outer parapet.
  ctx.beginPath();
  polyPath(ctx, offsetLine(top, r.outer * W * 0.24), false);
  ctx.setLineDash([1.0, 1.0]);
  ctx.strokeStyle = w.tick;
  ctx.lineWidth = W * 0.3;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function shadowOf(ctx: Ctx2D, p: RProp) {
  const s = p.scale;
  const ell = (cx: number, cy: number, rx: number, ry: number) => {
    ctx.moveTo(cx + rx, cy);
    ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
  };
  const quad = (hx: number, hz: number, h: number, phi = p.phi) => {
    const pr = projector({ sx: p.sx, sy: p.sy, phi });
    const pts = [
      [-hx, -hz],
      [hx, -hz],
      [hx, hz],
      [-hx, hz],
    ].map(([x, z]) => pr(x!, z!));
    const dx = SX * h;
    const dy = SY * h;
    // Union of the footprint and its cast copy, as a hull of 8 points.
    const all = [...pts, ...pts.map(([x, y]) => [x + dx, y + dy] as Pt)];
    const hull = convexHull(all);
    polyPath(ctx, hull, true);
  };
  switch (p.prop) {
    case "house":
      quad(2.85 * s, 2.2 * s, 3.6 * p.height);
      break;
    case "chapel":
      quad(7.7 * chapelScale(p), 5.4 * chapelScale(p), 7.8 * chapelScale(p));
      break;
    case "tree":
      ell(p.sx + 1.2 * s, p.sy + 0.7 * s, 2.4 * s, 1.7 * s);
      break;
    case "bush":
      ell(p.sx + 0.6, p.sy + 0.4, 1.4 * s, 1.0 * s);
      break;
    case "sheep":
    case "cow":
    case "cart":
      ell(p.sx + 0.4, p.sy + 0.35, 1.1, 0.6);
      break;
    case "mill":
      ell(p.sx + 2, p.sy + 1.5, 3.2, 2);
      break;
    case "tower":
      quad(2.2, 2.2, 6 * p.height);
      break;
    case "round_tower":
      ell(p.sx + 2.4, p.sy + 1.8, 2.8, 2.2);
      break;
    case "gatehouse":
      quad(3.8, 2.4, 4.5, p.phi - Math.PI / 2);
      break;
    case "fountain":
      ell(p.sx + 0.6, p.sy + 0.5, 3.2, 2.4);
      break;
  }
}

function convexHull(pts: Pt[]): Pt[] {
  const P = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [];
  for (const p of P) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (const p of P.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function drawProp(ctx: Ctx2D, p: RProp, pal: IllustratedPalette, k: number) {
  const s = p.scale;
  const house: BoxStyle = { ...pal.house };
  const stone: BoxStyle = { light: pal.wall.topLight, base: pal.wall.top, shade: pal.wall.faceDark, outline: pal.wall.outline };
  switch (p.prop) {
    case "house": {
      const pr = projector(p);
      const hx = 2.75 * s;
      const hz = 2.05 * s;
      const h = 1.5 + 1.1 * (p.height - 0.8);
      boxWalls(ctx, pr, hx, hz, h, house, k, { color: pal.house.window, door: p.variant % 2 === 0 });
      const blue = p.variant === 5 && p.tint === 3;
      const colors = blue ? pal.towerRoof : (pal.roofs[p.tint % pal.roofs.length] ?? pal.roofs[0]!);
      roof(ctx, pr, hx, hz, h, 2.1 * s, colors, house, { hipped: p.variant % 3 === 2, outline: css(parseColor(pal.house.outline), k < 1.7 ? 0.38 : 0.55), k });
      break;
    }
    case "chapel":
      drawChapel(ctx, p, pal, k);
      break;
    case "tower": {
      const pr = projector(p);
      const h = 5.2 * p.height;
      const t = boxWalls(ctx, pr, 2.1, 2.1, h, stone, k);
      fillPoly(ctx, t, pal.wall.top, pal.wall.outline, 0.2);
      const c = centroid(t);
      cap(ctx, c[0], c[1] + 0.2, 2.9, 3.6, pal.towerRoof, css(parseColor(pal.house.outline), 0.6), false);
      break;
    }
    case "round_tower": {
      const h = 5.2 * p.height;
      const r = 2.3;
      const top = p.sy - h * OB;
      // Cylinder: side band shaded left-to-right, then the cap.
      const g = ctx.createLinearGradient(p.sx - r, 0, p.sx + r, 0);
      g.addColorStop(0, pal.wall.topLight);
      g.addColorStop(0.45, pal.wall.top);
      g.addColorStop(1, pal.wall.faceDark);
      ctx.beginPath();
      ctx.ellipse(p.sx, p.sy, r, r * 0.62, 0, 0, Math.PI);
      ctx.lineTo(p.sx - r, top);
      ctx.ellipse(p.sx, top, r, r * 0.62, 0, Math.PI, TAU);
      ctx.closePath();
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = pal.wall.outline;
      ctx.lineWidth = 0.2;
      ctx.stroke();
      if (k > 1.4) {
        ctx.fillStyle = pal.house.window;
        ctx.fillRect(p.sx - 0.25, top + h * OB * 0.35, 0.5, 0.9);
      }
      cap(ctx, p.sx, top, r + 0.5, 3.8, pal.towerRoof, pal.wall.outline, true);
      break;
    }
    case "gatehouse": {
      const pr = projector({ ...p, phi: p.phi - Math.PI / 2 });
      const h = 4.2;
      const t = boxWalls(ctx, pr, 3.6, 2.2, h, stone, k);
      fillPoly(ctx, t, pal.wall.top, pal.wall.outline, 0.2);
      // Gate arch on the faces along the road.
      for (const sgn of [1, -1]) {
        const a = pr(-1.1, sgn * 2.2, 0);
        const b = pr(1.1, sgn * 2.2, 0);
        const dirY = pr(0, sgn * 3, 0)[1] - pr(0, 0, 0)[1];
        if (dirY <= 0.05) continue;
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(a[0], a[1] - 2.2 * OB);
        ctx.quadraticCurveTo((a[0] + b[0]) / 2, a[1] - 3.6 * OB, b[0], b[1] - 2.2 * OB);
        ctx.lineTo(b[0], b[1]);
        ctx.closePath();
        ctx.fillStyle = "#3b2d20";
        ctx.fill();
      }
      ctx.beginPath();
      polyPath(ctx, t, true);
      ctx.setLineDash([0.8, 0.8]);
      ctx.strokeStyle = pal.wall.tick;
      ctx.lineWidth = 0.5;
      ctx.stroke();
      ctx.setLineDash([]);
      break;
    }
    case "tree": {
      const r = 2.1 * s;
      const c: Pt = [p.sx, p.sy - 1.5];
      ctx.fillStyle = pal.tree.trunk;
      ctx.fillRect(p.sx - 0.3, p.sy - 1.5, 0.6, 1.5);
      blob(ctx, c, r, pal.tree, p.variant + p.tint * 7);
      break;
    }
    case "bush":
      blob(ctx, [p.sx, p.sy - 0.5], 1.15 * s, pal.bush, p.variant * 3 + p.tint);
      break;
    case "sheep": {
      const pr = projector(p);
      const [cx, cy] = pr(0, 0, 0.5);
      ctx.beginPath();
      ctx.ellipse(cx, cy, 0.95, 0.65, p.phi, 0, TAU);
      ctx.fillStyle = pal.sheep;
      ctx.fill();
      ctx.strokeStyle = "rgba(90,90,80,0.55)";
      ctx.lineWidth = 0.14;
      ctx.stroke();
      const hd = pr(0, 0.95, 0.55);
      ctx.beginPath();
      ctx.arc(hd[0], hd[1], 0.36, 0, TAU);
      ctx.fillStyle = "#3a332c";
      ctx.fill();
      break;
    }
    case "cow": {
      const pr = projector(p);
      const [cx, cy] = pr(0, 0, 0.6);
      ctx.beginPath();
      ctx.ellipse(cx, cy, 1.25, 0.72, p.phi + Math.PI / 2, 0, TAU);
      ctx.fillStyle = pal.cow[p.variant % 2]!;
      ctx.fill();
      ctx.strokeStyle = "rgba(50,35,20,0.6)";
      ctx.lineWidth = 0.14;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx + Math.cos(p.phi) * 0.3, cy + Math.sin(p.phi) * 0.3, 0.35, 0, TAU);
      ctx.fillStyle = pal.cow[(p.variant + 1) % 2]!;
      ctx.fill();
      const hd = pr(0, 1.35, 0.6);
      ctx.beginPath();
      ctx.arc(hd[0], hd[1], 0.42, 0, TAU);
      ctx.fillStyle = "#3a2a1c";
      ctx.fill();
      break;
    }
    case "duck": {
      ctx.beginPath();
      ctx.ellipse(p.sx, p.sy, 0.7, 0.45, p.phi, 0, TAU);
      ctx.fillStyle = "#fbfaf2";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p.sx + Math.cos(p.phi) * 0.7, p.sy + Math.sin(p.phi) * 0.7, 0.2, 0, TAU);
      ctx.fillStyle = "#f0a020";
      ctx.fill();
      break;
    }
    case "cart": {
      const pr = projector(p);
      boxWalls(ctx, pr, 0.8, 1.3, 0.8, { light: "#a8743f", base: "#8a5a2e", shade: "#6a4220", outline: "#3d2614" }, k);
      fillPoly(ctx, [pr(-0.8, -1.3, 0.8), pr(0.8, -1.3, 0.8), pr(0.8, 1.3, 0.8), pr(-0.8, 1.3, 0.8)], "#b98a4e", "#3d2614", 0.15);
      break;
    }
    case "mill":
      drawMill(ctx, p, pal, k);
      break;
    case "fountain": {
      const r = 3;
      ctx.beginPath();
      ctx.ellipse(p.sx, p.sy - 0.4, r, r * 0.7, 0, 0, TAU);
      ctx.fillStyle = pal.wall.face;
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(p.sx, p.sy - 0.9, r, r * 0.7, 0, 0, TAU);
      ctx.fillStyle = pal.wall.top;
      ctx.fill();
      ctx.strokeStyle = pal.wall.outline;
      ctx.lineWidth = 0.2;
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(p.sx, p.sy - 0.9, r * 0.74, r * 0.5, 0, 0, TAU);
      ctx.fillStyle = pal.water.base;
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(p.sx - 0.6, p.sy - 1.3, r * 0.3, r * 0.14, -0.3, 0, TAU);
      ctx.fillStyle = css(parseColor(pal.water.ripple), 0.8);
      ctx.fill();
      ctx.fillStyle = pal.wall.top;
      ctx.fillRect(p.sx - 0.35, p.sy - 3.2, 0.7, 2.3);
      ctx.beginPath();
      ctx.arc(p.sx, p.sy - 3.3, 0.7, 0, TAU);
      ctx.fillStyle = pal.water.light;
      ctx.fill();
      break;
    }
  }
}

/** A round tree crown / bush: dark base, lobes, a lit top-left. */
function blob(ctx: Ctx2D, c: Pt, r: number, col: { dark: string; base: string; light: string }, seed: number) {
  const R = rng(seed * 2654435761);
  ctx.beginPath();
  ctx.arc(c[0] + r * 0.12, c[1] + r * 0.12, r, 0, TAU);
  ctx.fillStyle = col.dark;
  ctx.fill();
  const lobes = 4;
  ctx.fillStyle = col.base;
  ctx.beginPath();
  for (let i = 0; i < lobes; i++) {
    const a = (i / lobes) * TAU + R();
    const x = c[0] + Math.cos(a) * r * 0.35 - r * 0.08;
    const y = c[1] + Math.sin(a) * r * 0.35 - r * 0.08;
    ctx.moveTo(x + r * 0.6, y);
    ctx.arc(x, y, r * 0.6, 0, TAU);
  }
  ctx.fill();
  ctx.beginPath();
  ctx.arc(c[0] - r * 0.32, c[1] - r * 0.34, r * 0.38, 0, TAU);
  ctx.fillStyle = col.light;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(c[0] - r * 0.42, c[1] - r * 0.45, r * 0.16, 0, TAU);
  ctx.fillStyle = shade(col.light, 0.25);
  ctx.fill();
}

function drawCrop(ctx: Ctx2D, p: RProp, pal: IllustratedPalette) {
  const pr = projector(p);
  const hx = 3.4 * p.scale;
  const hz = 2.4 * p.scale;
  const P = [pr(-hx, -hz), pr(hx, -hz), pr(hx, hz), pr(-hx, hz)];
  ctx.save();
  ctx.beginPath();
  polyPath(ctx, P, true);
  ctx.fillStyle = css(parseColor(p.tint % 2 ? pal.crop.a : pal.crop.b), 0.4);
  ctx.fill();
  ctx.clip();
  ctx.strokeStyle = css(parseColor(pal.crop.edge), 0.25);
  ctx.lineWidth = 0.35;
  ctx.beginPath();
  for (let z = -hz; z <= hz; z += 0.9) {
    const a = pr(-hx, z);
    const b = pr(hx, z);
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
  }
  ctx.stroke();
  ctx.restore();
}

function drawBridge(ctx: Ctx2D, p: RProp, pal: IllustratedPalette) {
  const pr = projector(p);
  const hx = 7.5;
  const hz = 6;
  ctx.save();
  fillPoly(ctx, [pr(-hx, -hz * 0.75), pr(hx, -hz * 0.75), pr(hx, hz * 0.75), pr(-hx, hz * 0.75)], pal.road.base, pal.road.edge, 0.3);
  for (const sgn of [1, -1]) {
    ctx.beginPath();
    const a = pr(-hx, sgn * hz * 0.75);
    const b = pr(hx, sgn * hz * 0.75);
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.strokeStyle = pal.wall.outline;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.strokeStyle = pal.wall.top;
    ctx.lineWidth = 1.0;
    ctx.stroke();
  }
  ctx.restore();
}

function drawChapel(ctx: Ctx2D, p: RProp, pal: IllustratedPalette, k: number) {
  // An abbey: a long church nave, a cross wing (the monks' range) and a bell tower,
  // drawn back to front.
  const s = chapelScale(p);
  const pr = projector(p);
  const wallSt: BoxStyle = { ...pal.house };
  const roofCol = pal.roofs[1]!;
  const outline = css(parseColor(pal.house.outline), 0.7);
  type Part = { lx: number; lz: number; turn: number; hx: number; hz: number; h: number; rise: number; tower?: boolean };
  const parts: Part[] = [
    { lx: 0, lz: -0.6 * s, turn: 0, hx: 7.4 * s, hz: 3.6 * s, h: 4.4 * s, rise: 3.4 * s },
    { lx: 4.2 * s, lz: 2.2 * s, turn: Math.PI / 2, hx: 3.6 * s, hz: 2.6 * s, h: 3.6 * s, rise: 2.4 * s },
    { lx: -6.6 * s, lz: 2.3 * s, turn: 0, hx: 1.9 * s, hz: 1.9 * s, h: 9 * s, rise: 4 * s, tower: true },
  ];
  const placed = parts.map((q) => {
    const [sx, sy] = pr(q.lx, q.lz);
    return { q, at: { sx, sy, phi: p.phi + q.turn } };
  });
  placed.sort((a, b) => a.at.sy - b.at.sy);
  for (const { q, at } of placed) {
    const qp = projector(at);
    if (q.tower) {
      const t = boxWalls(ctx, qp, q.hx, q.hz, q.h, wallSt, k, { color: pal.house.window });
      fillPoly(ctx, t, pal.house.base, outline, 0.2);
      const c = centroid(t);
      cap(ctx, c[0], c[1] + 0.2, q.hx * 1.45, q.rise, roofCol, outline, false);
      const top: Pt = [c[0], c[1] + 0.2 - q.rise * OB];
      ctx.strokeStyle = "#4a3a28";
      ctx.lineWidth = 0.32;
      ctx.beginPath();
      ctx.moveTo(top[0], top[1]);
      ctx.lineTo(top[0], top[1] - 1.8);
      ctx.moveTo(top[0] - 0.65, top[1] - 1.25);
      ctx.lineTo(top[0] + 0.65, top[1] - 1.25);
      ctx.stroke();
    } else {
      boxWalls(ctx, qp, q.hx, q.hz, q.h, wallSt, k, { color: pal.house.window, door: true });
      roof(ctx, qp, q.hx, q.hz, q.h, q.rise, roofCol, wallSt, { outline, k, overhang: 0.45 });
    }
  }
}

function drawMill(ctx: Ctx2D, p: RProp, pal: IllustratedPalette, k: number) {
  const pr = projector(p);
  const h = 4.2;
  const t = boxWalls(ctx, pr, 2.2, 2.2, h, { ...pal.house }, k, { color: pal.house.window, door: true });
  const c = centroid(t);
  cap(ctx, c[0], c[1] + 0.2, 3, 2.6, pal.roofs[0]!, pal.house.outline, false);
  // Sails.
  const hub: Pt = [c[0], c[1] - 0.6];
  ctx.save();
  ctx.lineCap = "butt";
  for (let i = 0; i < 4; i++) {
    const a = 0.45 + (i * Math.PI) / 2;
    const ex = hub[0] + Math.cos(a) * 4.6;
    const ey = hub[1] + Math.sin(a) * 4.6;
    ctx.strokeStyle = "#5a4028";
    ctx.lineWidth = 0.3;
    ctx.beginPath();
    ctx.moveTo(hub[0], hub[1]);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.strokeStyle = "rgba(250,244,228,0.92)";
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(hub[0] + Math.cos(a) * 1.4 - Math.sin(a) * 0.55, hub[1] + Math.sin(a) * 1.4 + Math.cos(a) * 0.55);
    ctx.lineTo(ex - Math.sin(a) * 0.55, ey + Math.cos(a) * 0.55);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(hub[0], hub[1], 0.45, 0, TAU);
  ctx.fillStyle = "#4a3422";
  ctx.fill();
  ctx.restore();
}

function drawCourtyard(ctx: Ctx2D, P: Pt[], pal: IllustratedPalette) {
  // A soft gravel yard around the abbey, with a small kitchen garden.
  const c = centroid(P);
  let r = 0;
  for (const p of P) r = Math.max(r, Math.hypot(p[0] - c[0], p[1] - c[1]));
  r *= 1.3;
  ctx.save();
  const g = ctx.createRadialGradient(c[0], c[1], r * 0.55, c[0], c[1], r);
  g.addColorStop(0, pal.gravel.base);
  g.addColorStop(0.75, mix(pal.gravel.base, pal.gravel.base, 0, 0.85));
  g.addColorStop(1, mix(pal.gravel.base, pal.gravel.base, 0, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(c[0], c[1], r, r * 0.9, 0, 0, TAU);
  ctx.fill();
  // Garden beds in the lower-right corner of the yard.
  const bx = c[0] + r * 0.42;
  const by = c[1] + r * 0.5;
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = i % 2 ? pal.hedge.base : pal.crop.a;
    ctx.fillRect(bx - 3 + i * 2.1, by - 1.6, 1.5, 3.2);
  }
  ctx.restore();
}

function drawGardenGround(ctx: Ctx2D, P0: Pt[], pal: IllustratedPalette, R: () => number) {
  const c = centroid(P0);
  // A touch larger than the geo footprint so the hedged garden reads at board zoom.
  const P = P0.map(([x, y]) => [c[0] + (x - c[0]) * 1.3, c[1] + (y - c[1]) * 1.3] as Pt);
  ctx.save();
  ctx.beginPath();
  polyPath(ctx, P, true);
  ctx.fillStyle = pal.grass.light;
  ctx.fill();
  ctx.clip();
  // Gravel cross paths.
  let r = 0;
  for (const p of P) r = Math.max(r, Math.hypot(p[0] - c[0], p[1] - c[1]));
  ctx.strokeStyle = pal.gravel.base;
  ctx.lineWidth = 2.2;
  ctx.lineCap = "butt";
  ctx.beginPath();
  ctx.moveTo(c[0] - r, c[1]);
  ctx.lineTo(c[0] + r, c[1]);
  ctx.moveTo(c[0], c[1] - r);
  ctx.lineTo(c[0], c[1] + r);
  ctx.stroke();
  // Flower beds in the quadrants.
  for (const [qx, qy] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    const bx = c[0] + qx * r * 0.45;
    const by = c[1] + qy * r * 0.45;
    for (let i = 0; i < 9; i++) {
      ctx.beginPath();
      ctx.arc(bx + (R() - 0.5) * r * 0.5, by + (R() - 0.5) * r * 0.5, 0.45, 0, TAU);
      ctx.fillStyle = pal.grass.flowers[Math.floor(R() * pal.grass.flowers.length)]!;
      ctx.fill();
    }
  }
  ctx.restore();
  // Hedge ring: bumpy dark-green border with a lit top-left.
  const per: Pt[] = [];
  for (let i = 0; i < P.length; i++) {
    const a = P[i]!;
    const b = P[(i + 1) % P.length]!;
    const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 1.6));
    for (let j = 0; j < n; j++) per.push([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n]);
  }
  ctx.fillStyle = pal.shadow;
  ctx.beginPath();
  for (const [x, y] of per) {
    ctx.moveTo(x + 0.6 + 1.3, y + 0.5);
    ctx.arc(x + 0.6, y + 0.5, 1.3, 0, TAU);
  }
  ctx.fill();
  for (const [col, dx, rr] of [
    [pal.hedge.dark, 0.1, 1.25],
    [pal.hedge.base, -0.15, 1.05],
    [pal.hedge.light, -0.45, 0.45],
  ] as const) {
    ctx.fillStyle = col;
    ctx.beginPath();
    for (const [x, y] of per) {
      ctx.moveTo(x + dx + rr, y + dx - 0.4);
      ctx.arc(x + dx, y + dx - 0.4, rr, 0, TAU);
    }
    ctx.fill();
  }
  // Fruit trees in the quadrants (an orchard inside the hedge).
  for (const [qx, qy] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    const tx = c[0] + qx * r * 0.5;
    const ty = c[1] + qy * r * 0.5;
    ctx.fillStyle = pal.shadow;
    ctx.beginPath();
    ctx.ellipse(tx + 0.9, ty + 0.6, 1.9, 1.4, 0, 0, TAU);
    ctx.fill();
    blob(ctx, [tx, ty - 0.9], 1.75, pal.tree, qx * 3 + qy + 7);
    ctx.fillStyle = "#e0442c";
    for (const [fx, fy] of [
      [-0.6, -0.2],
      [0.5, 0.3],
      [0.1, -0.8],
    ] as const) {
      ctx.beginPath();
      ctx.arc(tx + fx, ty - 0.9 + fy, 0.28, 0, TAU);
      ctx.fill();
    }
  }
}

/** Abbey scale: geo's footprint scale, enlarged to read like the printed cloister, but kept inside the tile. */
function chapelScale(p: RProp): number {
  const s = p.scale * 1.8;
  const side = Math.min(p.sx, 100 - p.sx) - 1;
  return Math.max(0.6 * p.scale, Math.min(s, side / 9.8, (p.sy - 1) / 15, (100 - p.sy - 1) / 6.5));
}

function drawWell(ctx: Ctx2D, [x, y]: Pt, pal: IllustratedPalette, k: number) {
  const r = 2.2;
  ctx.fillStyle = pal.shadow;
  ctx.beginPath();
  ctx.ellipse(x + 0.9, y + 0.7, r, r * 0.75, 0, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.7, 0, 0, Math.PI);
  ctx.lineTo(x - r, y - 1.2);
  ctx.ellipse(x, y - 1.2, r, r * 0.7, 0, Math.PI, 0, true);
  ctx.closePath();
  ctx.fillStyle = pal.wall.face;
  ctx.fill();
  ctx.strokeStyle = pal.wall.outline;
  ctx.lineWidth = 0.2;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(x, y - 1.2, r, r * 0.7, 0, 0, TAU);
  ctx.fillStyle = pal.wall.top;
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(x, y - 1.2, r * 0.62, r * 0.42, 0, 0, TAU);
  ctx.fillStyle = "#2c4a5e";
  ctx.fill();
  if (k > 1.5) {
    ctx.beginPath();
    ctx.ellipse(x - 0.4, y - 1.4, r * 0.22, r * 0.1, 0, 0, TAU);
    ctx.fillStyle = "rgba(220,240,255,0.7)";
    ctx.fill();
  }
}

/** Blue-and-white quartered shield. */
function drawPennant(ctx: Ctx2D, x: number, y: number, pal: IllustratedPalette, scale = 1) {
  const w = 3.6 * scale;
  const h = 4 * scale;
  const shield = (dx: number, dy: number, grow = 0) => {
    ctx.beginPath();
    ctx.moveTo(x - w - grow + dx, y - h - grow + dy);
    ctx.lineTo(x + w + grow + dx, y - h - grow + dy);
    ctx.lineTo(x + w + grow + dx, y + dy);
    ctx.quadraticCurveTo(x + w + grow + dx, y + h * 0.85 + dy, x + dx, y + h * 1.3 + grow + dy);
    ctx.quadraticCurveTo(x - w - grow + dx, y + h * 0.85 + dy, x - w - grow + dx, y + dy);
    ctx.closePath();
  };
  ctx.save();
  shield(0.8, 0.8, 0.3);
  ctx.fillStyle = pal.shadow;
  ctx.fill();
  shield(0, 0, 0.55);
  ctx.fillStyle = pal.pennant.check;
  ctx.fill();
  shield(0, 0);
  ctx.fillStyle = pal.pennant.field;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = pal.pennant.check;
  ctx.fillRect(x - w, y - h, w, h * 1.05);
  ctx.fillRect(x, y + h * 0.05, w, h * 1.4);
  // Soft highlight.
  const g = ctx.createLinearGradient(x - w, y - h, x + w, y + h);
  g.addColorStop(0, "rgba(255,255,255,0.35)");
  g.addColorStop(0.6, "rgba(255,255,255,0)");
  g.addColorStop(1, "rgba(0,0,30,0.25)");
  ctx.fillStyle = g;
  ctx.fillRect(x - w, y - h, w * 2, h * 2.4);
  ctx.restore();
  shield(0, 0);
  ctx.strokeStyle = pal.pennant.rim;
  ctx.lineWidth = 0.45;
  ctx.stroke();
  ctx.restore();
}

function bevel(ctx: Ctx2D, pal: IllustratedPalette) {
  const b = 0.85;
  ctx.save();
  ctx.fillStyle = pal.bevel.light;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(100, 0);
  ctx.lineTo(100 - b, b);
  ctx.lineTo(b, b);
  ctx.lineTo(b, 100 - b);
  ctx.lineTo(0, 100);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = pal.bevel.dark;
  ctx.beginPath();
  ctx.moveTo(100, 100);
  ctx.lineTo(0, 100);
  ctx.lineTo(b, 100 - b);
  ctx.lineTo(100 - b, 100 - b);
  ctx.lineTo(100 - b, b);
  ctx.lineTo(100, 0);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
