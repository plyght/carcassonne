// Seamless (1-tile periodic) textures for the painted tiles: grass, city ground,
// road sand, water and paper grain. Built once per (palette, pixel size) and shared
// by every tile, so a tile costs little more than its vector details.

import type { IllustratedPalette } from "../palette";
import { css, mixRgb, parseColor, periodicFbm, periodicNoise, rng, type RGB } from "./noise";
import { ctx2d, makeCanvas, type AnyCanvas, type Ctx2D } from "./types";

export interface TextureSet {
  size: number;
  grass: AnyCanvas;
  ground: AnyCanvas;
  sand: AnyCanvas;
  water: AnyCanvas;
  /** Neutral-grey grain to blend with "soft-light". */
  grain: AnyCanvas;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

function ramp(stops: RGB[], t: number): RGB {
  const x = clamp01(t) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  return mixRgb(stops[i]!, stops[i + 1]!, x - i);
}

/** Fill a canvas pixel by pixel from f(u, v) → RGB. */
function pixels(size: number, f: (u: number, v: number) => RGB): AnyCanvas {
  const c = makeCanvas(size, size);
  const ctx = ctx2d(c);
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0, o = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++, o += 4) {
      const [r, g, b] = f(x / size, v);
      d[o] = r;
      d[o + 1] = g;
      d[o + 2] = b;
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Draw `fn` at (x, y) and at its wrapped copies near the tile borders (tile units). */
function wrapped(x: number, y: number, r: number, fn: (x: number, y: number) => void) {
  const xs = [x];
  const ys = [y];
  if (x < r) xs.push(x + 100);
  if (x > 100 - r) xs.push(x - 100);
  if (y < r) ys.push(y + 100);
  if (y > 100 - r) ys.push(y - 100);
  for (const a of xs) for (const b of ys) fn(a, b);
}

function strokes(_ctx: Ctx2D, n: number, seed: number, draw: (r: () => number, x: number, y: number) => void) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const x = r() * 100;
    const y = r() * 100;
    draw(r, x, y);
  }
}

function buildGrass(p: IllustratedPalette, size: number): AnyCanvas {
  const g = p.grass;
  const stops = [parseColor(g.dark), parseColor(g.base), parseColor(g.base), parseColor(g.light)];
  const big = periodicFbm(3, 4, 11, 0.55);
  const fine = periodicNoise(48, 23);
  const c = pixels(size, (u, v) => {
    const n = clamp01((big(u, v) - 0.5) * 2.1 + 0.52 + (fine(u, v) - 0.5) * 0.12);
    return ramp(stops, n);
  });
  const ctx = ctx2d(c);
  ctx.scale(size / 100, size / 100);
  ctx.lineCap = "round";
  // Painterly dabs: short light blades and darker tufts, wrapped at the borders.
  const blade = parseColor(g.blade);
  const tuft = parseColor(g.tuft);
  const light = parseColor(g.light);
  strokes(ctx, 1300, 101, (r, x, y) => {
    const a = -Math.PI / 2 + (r() - 0.5) * 1.3;
    const len = 0.7 + r() * 1.1;
    const col = r() < 0.55 ? css(blade, 0.22 + r() * 0.2) : css(tuft, 0.16 + r() * 0.16);
    const w = 0.22 + r() * 0.2;
    wrapped(x, y, 2, (px, py) => {
      ctx.strokeStyle = col;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len);
      ctx.stroke();
    });
  });
  // Little grass tufts (three-blade "v"s), like the printed tiles.
  strokes(ctx, 70, 202, (_r, x, y) => {
    const col = css(tuft, 0.45);
    wrapped(x, y, 2, (px, py) => {
      ctx.strokeStyle = col;
      ctx.lineWidth = 0.28;
      ctx.beginPath();
      for (const d of [-0.55, 0, 0.55]) {
        ctx.moveTo(px, py);
        ctx.lineTo(px + d * 0.9, py - 1.05 + Math.abs(d) * 0.3);
      }
      ctx.stroke();
    });
  });
  // Soft light flecks.
  strokes(ctx, 160, 303, (r, x, y) => {
    const rad = 0.25 + r() * 0.45;
    const col = css(light, 0.25);
    wrapped(x, y, 1, (px, py) => {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(px, py, rad, 0, Math.PI * 2);
      ctx.fill();
    });
  });
  return c;
}

function buildGround(p: IllustratedPalette, size: number): AnyCanvas {
  const g = p.ground;
  const stops = [parseColor(g.dark), parseColor(g.base), parseColor(g.light)];
  const big = periodicFbm(4, 3, 31);
  const fine = periodicNoise(40, 37);
  const c = pixels(size, (u, v) => ramp(stops, (big(u, v) - 0.5) * 1.8 + 0.5 + (fine(u, v) - 0.5) * 0.35));
  const ctx = ctx2d(c);
  ctx.scale(size / 100, size / 100);
  const speck = parseColor(g.speck);
  const light = parseColor(g.light);
  strokes(ctx, 420, 404, (r, x, y) => {
    const rad = 0.18 + r() * 0.35;
    const col = r() < 0.6 ? css(speck, 0.35) : css(light, 0.6);
    wrapped(x, y, 1, (px, py) => {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(px, py, rad, 0, Math.PI * 2);
      ctx.fill();
    });
  });
  return c;
}

function buildSand(p: IllustratedPalette, size: number): AnyCanvas {
  const r0 = p.road;
  const stops = [parseColor(r0.rut), parseColor(r0.base), parseColor(r0.light)];
  const big = periodicFbm(6, 3, 51);
  const fine = periodicNoise(64, 53);
  const c = pixels(size, (u, v) => ramp(stops, (big(u, v) - 0.5) * 1.4 + 0.55 + (fine(u, v) - 0.5) * 0.3));
  const ctx = ctx2d(c);
  ctx.scale(size / 100, size / 100);
  const pebble = parseColor(r0.edge);
  strokes(ctx, 260, 505, (r, x, y) => {
    const rad = 0.12 + r() * 0.22;
    const col = css(pebble, 0.3);
    wrapped(x, y, 1, (px, py) => {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(px, py, rad, 0, Math.PI * 2);
      ctx.fill();
    });
  });
  return c;
}

function buildWater(p: IllustratedPalette, size: number): AnyCanvas {
  const w = p.water;
  const stops = [parseColor(w.deep), parseColor(w.base), parseColor(w.light)];
  const big = periodicFbm(4, 3, 71);
  return pixels(size, (u, v) => ramp(stops, (big(u, v) - 0.5) * 1.5 + 0.5));
}

function buildGrain(size: number): AnyCanvas {
  const fine = periodicNoise(Math.max(16, Math.round(size / 3)), 91);
  const mid = periodicNoise(24, 97);
  return pixels(size, (u, v) => {
    const g = 128 + (fine(u, v) - 0.5) * 34 + (mid(u, v) - 0.5) * 22;
    return [g, g, g];
  });
}

const cache = new Map<string, TextureSet>();

export function texturesFor(paletteId: string, p: IllustratedPalette, size: number): TextureSet {
  const key = `${paletteId}|${size}`;
  let t = cache.get(key);
  if (!t) {
    t = { size, grass: buildGrass(p, size), ground: buildGround(p, size), sand: buildSand(p, size), water: buildWater(p, size), grain: buildGrain(size) };
    cache.set(key, t);
  }
  return t;
}
