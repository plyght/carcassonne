// Deterministic randomness and colour helpers for the painted tiles. Everything is
// seeded (tile id hash, fixed texture seeds), so every client paints identical art.

/** FNV-1a hash of a string (u32). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: small, fast, good enough for scattering. Returns [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Value noise that repeats every 1 unit in u and v (lattice `period` cells per unit).
 * Textures built from it tile seamlessly, so grass matches across every tile seam.
 */
export function periodicNoise(period: number, seed: number): (u: number, v: number) => number {
  const r = rng(seed);
  const g = new Float32Array(period * period);
  for (let i = 0; i < g.length; i++) g[i] = r();
  const at = (i: number, j: number) => g[(((j % period) + period) % period) * period + (((i % period) + period) % period)]!;
  return (u, v) => {
    const x = u * period;
    const y = v * period;
    const i = Math.floor(x);
    const j = Math.floor(y);
    let fx = x - i;
    let fy = y - j;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const a = at(i, j);
    const b = at(i + 1, j);
    const c = at(i, j + 1);
    const d = at(i + 1, j + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

/** Fractal sum of periodic octaves, normalised to ~[0, 1]. */
export function periodicFbm(basePeriod: number, octaves: number, seed: number, gain = 0.5): (u: number, v: number) => number {
  const layers = Array.from({ length: octaves }, (_, k) => periodicNoise(basePeriod << k, seed + k * 7919));
  let norm = 0;
  for (let k = 0, w = 1; k < octaves; k++, w *= gain) norm += w;
  return (u, v) => {
    let s = 0;
    let w = 1;
    for (const n of layers) {
      s += n(u, v) * w;
      w *= gain;
    }
    return s / norm;
  };
}

export type RGB = [number, number, number];

const rgbCache = new Map<string, RGB>();

/** Parse #rgb / #rrggbb / rgb()/rgba() into 0..255 channels. */
export function parseColor(c: string): RGB {
  const hit = rgbCache.get(c);
  if (hit) return hit;
  let out: RGB = [0, 0, 0];
  if (c.startsWith("#")) {
    const h = c.length === 4 ? c.slice(1).split("").map((x) => x + x).join("") : c.slice(1, 7);
    out = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  } else {
    const m = c.match(/[\d.]+/g);
    if (m) out = [Number(m[0]), Number(m[1]), Number(m[2])];
  }
  rgbCache.set(c, out);
  return out;
}

export function mixRgb(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function css([r, g, b]: RGB, alpha = 1): string {
  return alpha >= 1 ? `rgb(${r | 0},${g | 0},${b | 0})` : `rgba(${r | 0},${g | 0},${b | 0},${alpha})`;
}

/** Mix two CSS colours. */
export function mix(a: string, b: string, t: number, alpha = 1): string {
  return css(mixRgb(parseColor(a), parseColor(b), t), alpha);
}

/** Lighten (t > 0, towards white) or darken (t < 0, towards black). */
export function shade(c: string, t: number): string {
  return t >= 0 ? mix(c, "#ffffff", t) : mix(c, "#000000", -t);
}
