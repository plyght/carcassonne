// Style pack / board palette  <->  DialKit panel config.
//
// Every field of a pack becomes a DialKit control: colours → colour pickers, numbers →
// sliders with sensible ranges, enums → selects, booleans → toggles, other strings →
// text. Arrays of colours become folders (roofs 1–4, players by seat colour), and
// optional blocks (tilt-shift, SSAO, ink outline, fog) get an "enabled" toggle. The
// reverse walk turns the panel's values back into a pack / palette.

import type { DialConfig } from "dialkit";

import { PLAYER_COLOR_ORDER, type BoardPalette } from "@carcassonne/render-classic";
import { DEFAULT_STYLE, type StylePack, type Tier } from "@carcassonne/render-three/styles";

type Range = [number, number, number];

const HEX = /^#[0-9a-fA-F]{6}$/;
const COLORISH = /^(#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(|oklch\()/;

/** Slider ranges by dotted path (numbers missing here get a range around their value). */
const PACK_RANGES: Record<string, Range> = {
  "lighting.sun.intensity": [0, 6, 0.05],
  "lighting.sun.azimuth": [-180, 180, 1],
  "lighting.sun.elevation": [5, 90, 1],
  "lighting.hemisphere.intensity": [0, 3, 0.05],
  "lighting.environment": [0, 2, 0.01],
  "lighting.exposure": [0.2, 2, 0.01],
  "lighting.shadowSoftness": [0, 12, 0.5],
  "terrain.grassNoise": [0, 1, 0.01],
  "terrain.noiseScale": [0.5, 8, 0.1],
  "terrain.grain": [0, 1, 0.01],
  "terrain.seamWidth": [0, 0.04, 0.001],
  "terrain.seamDarken": [0, 1, 0.01],
  "terrain.tileGap": [0, 0.03, 0.0005],
  "terrain.heightJitter": [0, 0.03, 0.001],
  "terrain.ao": [0, 1, 0.01],
  "terrain.resolution.low": [8, 96, 4],
  "terrain.resolution.medium": [8, 96, 4],
  "terrain.resolution.high": [8, 96, 4],
  "materials.roughness": [0, 1, 0.01],
  "materials.metalness": [0, 1, 0.01],
  "materials.figureRoughness": [0, 1, 0.01],
  "materials.toonSteps": [1, 8, 1],
  "materials.outline.thickness": [0, 0.03, 0.0005],
  "materials.stoneNoise": [0, 1, 0.01],
  "props.scale": [0.5, 2, 0.01],
  "props.houseHeight": [0.5, 2, 0.01],
  "anim.speed": [0.25, 3, 0.05],
  "anim.squash": [0, 1, 0.01],
  "anim.overshoot": [0, 1, 0.01],
  "post.tiltShift.focus": [0, 1, 0.01],
  "post.tiltShift.range": [0, 1, 0.01],
  "post.tiltShift.blur": [0, 10, 0.1],
  "post.ssao.radius": [0, 0.5, 0.005],
  "post.ssao.intensity": [0, 3, 0.05],
  "post.saturation": [0, 2, 0.01],
  "post.vignette": [0, 1, 0.01],
  "fog.density": [0, 0.1, 0.001],
};

const PACK_ENUMS: Record<string, string[]> = {
  shading: ["pbr", "toon", "flat"],
  "lighting.toneMapping": ["none", "aces", "agx", "neutral"],
  "anim.preset": ["realistic", "cartoon"],
  "popups.kind": ["coin", "comic", "bubble"],
};

/** Defaults for optional blocks when a pack turns them on. */
const OPTIONAL_DEFAULTS: Record<string, unknown> = {
  "post.tiltShift": DEFAULT_STYLE.post.tiltShift,
  "post.ssao": DEFAULT_STYLE.post.ssao,
  "materials.outline": { color: "#1b1020", thickness: 0.006 },
  fog: { color: "#dfe9ef", density: 0.01 },
};

const TIER_SETS: Record<string, Tier[]> = { high: ["high"], "medium+": ["medium", "high"], all: ["low", "medium", "high"] };
const tierKey = (t: Tier[]) => (t.includes("low") ? "all" : t.includes("medium") ? "medium+" : "high");

/** Folder labels / order for the pack panel, and which start open. */
const SECTIONS: { key: keyof StylePack; open?: boolean }[] = [
  { key: "lighting", open: true },
  { key: "post", open: true },
  { key: "palette" },
  { key: "materials" },
  { key: "terrain" },
  { key: "props" },
  { key: "anim" },
  { key: "popups" },
  { key: "fog" },
];

function rangeFor(v: number, path: string, table: Record<string, Range>): Range {
  const r = table[path];
  if (r) return r;
  if (Number.isInteger(v)) return [0, Math.max(10, v * 3), 1];
  return [0, Math.max(1, Math.ceil(v * 3 * 100) / 100), 0.01];
}

function arrayLabels(path: string, n: number): string[] {
  if (path === "palette.players") return (PLAYER_COLOR_ORDER.slice(0, n) as string[]).concat(Array.from({ length: Math.max(0, n - 6) }, (_, i) => `seat${7 + i}`));
  const stem = path.split(".").pop()!.replace(/s$/, "");
  return Array.from({ length: n }, (_, i) => `${stem}${i + 1}`);
}

// ── style packs ─────────────────────────────────────────────────────────────

function toConfig(v: unknown, path: string, opts: { ranges: Record<string, Range>; enums: Record<string, string[]> }): DialConfig[string] {
  if (opts.enums[path]) return { type: "select", options: opts.enums[path]!, default: String(v) };
  if (typeof v === "number") {
    const [min, max, step] = rangeFor(v, path, opts.ranges);
    return [v, Math.min(min, v), Math.max(max, v), step];
  }
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return COLORISH.test(v) ? { type: "color", default: v } : { type: "text", default: v };
  if (Array.isArray(v)) {
    if (path.endsWith(".tiers")) return { type: "select", options: Object.keys(TIER_SETS), default: tierKey(v as Tier[]) };
    const labels = arrayLabels(path, v.length);
    const out: DialConfig = { _collapsed: true };
    v.forEach((item, i) => {
      if (Array.isArray(item)) {
        // [light, dark] pairs (illustrated roofs)
        out[labels[i]!] = { _collapsed: true, light: { type: "color", default: item[0] }, dark: { type: "color", default: item[1] } } as DialConfig;
      } else out[labels[i]!] = toConfig(item, `${path}[${i}]`, opts);
    });
    return out;
  }
  if (v && typeof v === "object") {
    const out: DialConfig = { _collapsed: true };
    for (const [k, x] of Object.entries(v)) out[k] = toConfig(x, path ? `${path}.${k}` : k, opts);
    return out;
  }
  return { type: "text", default: "" };
}

function fromValues(base: unknown, val: unknown, path: string): unknown {
  if (Array.isArray(base)) {
    if (path.endsWith(".tiers")) return TIER_SETS[String(val)] ?? base;
    const folder = (val ?? {}) as Record<string, unknown>;
    const labels = arrayLabels(path, base.length);
    return base.map((item, i) => {
      const x = folder[labels[i]!];
      if (Array.isArray(item)) {
        const pair = (x ?? {}) as { light?: string; dark?: string };
        return [pair.light ?? item[0], pair.dark ?? item[1]];
      }
      return fromValues(item, x, `${path}[${i}]`);
    });
  }
  if (base && typeof base === "object") {
    const folder = (val ?? {}) as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, b] of Object.entries(base)) out[k] = fromValues(b, folder[k], path ? `${path}.${k}` : k);
    return out;
  }
  if (val === undefined) return base;
  if (typeof base === "number") return typeof val === "number" ? val : base;
  if (typeof base === "string" && HEX.test(base)) return toHex(String(val)) ?? base;
  return val;
}

/** DialKit colour pickers may hand back rgb()/oklch(); style.json wants #rrggbb. */
function toHex(c: string): string | null {
  if (HEX.test(c)) return c.toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
  if (/^#[0-9a-f]{8}$/i.test(c)) return c.slice(0, 7).toLowerCase();
  const rgb = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/i.exec(c);
  if (rgb) return `#${[rgb[1], rgb[2], rgb[3]].map((n) => Math.round(Math.min(255, Number(n))).toString(16).padStart(2, "0")).join("")}`;
  if (typeof document !== "undefined") {
    // let the browser resolve anything else (oklch, color(display-p3 …))
    const cv = document.createElement("canvas").getContext("2d");
    if (cv) {
      cv.fillStyle = "#000";
      cv.fillStyle = c;
      const r = cv.fillStyle;
      if (HEX.test(r)) return r;
      return toHex(r);
    }
  }
  return null;
}

/** The DialKit panel config for every field of a style pack. */
export function packConfig(pack: StylePack): DialConfig {
  const opts = { ranges: PACK_RANGES, enums: PACK_ENUMS };
  const cfg: DialConfig = {
    shading: toConfig(pack.shading, "shading", opts),
  };
  for (const { key, open } of SECTIONS) {
    const v = pack[key] as unknown;
    if (key === "fog") {
      const fog = (v ?? OPTIONAL_DEFAULTS.fog) as object;
      cfg.fog = { _collapsed: true, enabled: v !== null, ...(toConfig(fog, "fog", opts) as DialConfig) };
      continue;
    }
    const folder = toConfig(v, key, opts) as DialConfig;
    // optional blocks inside this section
    for (const opt of Object.keys(OPTIONAL_DEFAULTS).filter((p) => p.startsWith(`${key}.`))) {
      const k = opt.split(".")[1]!;
      const cur = (v as Record<string, unknown>)[k];
      folder[k] = { _collapsed: !open, enabled: cur !== null, ...(toConfig(cur ?? OPTIONAL_DEFAULTS[opt], opt, opts) as DialConfig) };
    }
    if (open) delete folder._collapsed;
    cfg[key] = folder;
  }
  cfg.export = {
    copy: { type: "action", label: "Copy style.json" },
    download: { type: "action", label: "Download style.json" },
    reset: { type: "action", label: "Reset to shipped values" },
  };
  return cfg;
}

/** Panel values → a full pack object (validated by the caller via loadStylePack). */
export function packFromValues(base: StylePack, values: Record<string, unknown>): StylePack {
  const filled = {
    ...base,
    post: { ...base.post, tiltShift: base.post.tiltShift ?? OPTIONAL_DEFAULTS["post.tiltShift"], ssao: base.post.ssao ?? OPTIONAL_DEFAULTS["post.ssao"] },
    materials: { ...base.materials, outline: base.materials.outline ?? OPTIONAL_DEFAULTS["materials.outline"] },
    fog: base.fog ?? OPTIONAL_DEFAULTS.fog,
  } as StylePack;
  const out: Record<string, unknown> = { id: base.id, name: base.name, description: base.description };
  out.shading = values.shading ?? base.shading;
  for (const { key } of SECTIONS) out[key] = fromValues(filled[key], values[key], key);
  const enabled = (p: string) => {
    const parts = p.split(".");
    let v: unknown = values;
    for (const k of parts) v = (v as Record<string, unknown> | undefined)?.[k];
    return (v as Record<string, unknown> | undefined)?.enabled !== false;
  };
  const post = out.post as Record<string, unknown>;
  if (!enabled("post.tiltShift")) post.tiltShift = null;
  if (!enabled("post.ssao")) post.ssao = null;
  if (!enabled("materials.outline")) (out.materials as Record<string, unknown>).outline = null;
  if (!enabled("fog")) out.fog = null;
  return out as unknown as StylePack;
}

// ── 2D palettes ─────────────────────────────────────────────────────────────

const PALETTE_RANGES: Record<string, Range> = {
  "tile.borderWidth": [0, 4, 0.1],
  "city.wallWidth": [0, 10, 0.1],
  "road.casingWidth": [0, 16, 0.1],
  "road.fillWidth": [0, 14, 0.1],
};

const PALETTE_OPEN = new Set(["tile", "city", "road"]);

export function paletteConfig(p: BoardPalette): DialConfig {
  const opts = { ranges: PALETTE_RANGES, enums: {} };
  const { id: _id, ...rest } = p;
  const cfg: DialConfig = {};
  for (const [k, v] of Object.entries(rest)) {
    if (v === undefined) continue;
    const c = toConfig(v, k, opts);
    if (c && typeof c === "object" && !Array.isArray(c) && "_collapsed" in c && PALETTE_OPEN.has(k)) delete (c as DialConfig)._collapsed;
    cfg[k] = c;
  }
  cfg.export = {
    copy: { type: "action", label: "Copy palette (TS)" },
    reset: { type: "action", label: "Reset to shipped values" },
  };
  return cfg;
}

export function paletteFromValues(base: BoardPalette, values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, b] of Object.entries(base)) {
    if (k === "id" || b === undefined) continue;
    out[k] = fromValues(b, values[k], k);
  }
  return out;
}
