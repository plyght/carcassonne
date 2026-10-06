// Style packs: data, not code (docs/PRD.md §6.3). The JSON lives in
// packages/assets/styles/<id>/style.json (the same file the desktop renderer
// reads). This module has no three.js dependency, so a style registry can
// import it cheaply.
import cartoonJson from "../../assets/styles/cartoon/style.json";
import dioramaJson from "../../assets/styles/diorama/style.json";
import tabletopJson from "../../assets/styles/tabletop/style.json";

export type ShadingModel = "pbr" | "toon" | "flat";
export type AnimPreset = "realistic" | "cartoon";
export type PopupKind = "coin" | "comic" | "bubble";
export type ToneMapping = "none" | "aces" | "agx" | "neutral";
export type Tier = "low" | "medium" | "high";

/** Colours are CSS hex strings (`#rrggbb`). */
export interface StylePalette {
  background: string;
  table: string;
  /** Terrain by feature kind. */
  grass: string;
  /** Second grass colour, mixed in by the painterly noise. */
  grassAlt: string;
  road: string;
  city: string;
  riverBed: string;
  water: string;
  /** Cut sides of the tile slab. */
  slab: string;
  /** Colour the seam groove between tiles fades to. */
  seam: string;
  /** Masonry: walls, towers, gatehouses, plinths. */
  stone: string;
  stoneDark: string;
  /** Per-tint roof colours (prop `tint` indexes this list). */
  roofs: string[];
  /** House walls (plaster / timber). */
  plaster: string[];
  foliage: string[];
  trunk: string;
  wood: string;
  /** Windows, doors, arches. */
  dark: string;
  sheep: string;
  cow: string;
  crop: string;
  /** Meeple colours by player index. */
  players: string[];
}

export interface StyleLighting {
  sun: { color: string; intensity: number; azimuth: number; elevation: number };
  hemisphere: { sky: string; ground: string; intensity: number };
  /** Image-based ambient (procedural room environment), 0 = off. */
  environment: number;
  exposure: number;
  toneMapping: ToneMapping;
  /** Shadow softness (texels of PCF blur radius). */
  shadowSoftness: number;
}

export interface StyleTerrain {
  /** Strength of the painterly grass noise (0 = flat colour). */
  grassNoise: number;
  /** World-space frequency of the grass blotches (per tile). */
  noiseScale: number;
  /** Fine flock/grain noise on grass. */
  grain: number;
  /** Width (tile units) of the darkened groove at each tile edge. */
  seamWidth: number;
  /** 0..1 how dark the seam groove gets. */
  seamDarken: number;
  /** Gap between neighbouring tiles (tile units), shows the slab seams. */
  tileGap: number;
  /** Max per-tile height jitter (tile units). */
  heightJitter: number;
  /** Baked ambient occlusion in house/wall clusters (0..1). */
  ao: number;
  /** Mesh resolution per tier (terrain grid quads per side). */
  resolution: Record<Tier, number>;
}

export interface StyleMaterials {
  roughness: number;
  metalness: number;
  figureRoughness: number;
  /** Toon ramp steps (toon shading only). */
  toonSteps: number;
  /** Inverted-hull ink outline (toon shading). */
  outline: { color: string; thickness: number } | null;
  /** Masonry noise strength. */
  stoneNoise: number;
}

export interface StyleProps {
  /** Uniform scale on prop models. */
  scale: number;
  /** Extra vertical scale on houses. */
  houseHeight: number;
  /** Rounded (cartoon) vs crisp (tabletop) silhouettes. */
  rounded: boolean;
}

export interface StyleAnim {
  preset: AnimPreset;
  speed: number;
  /** Extra squash-and-stretch on landing (0 = none). */
  squash: number;
  /** Scale overshoot when props pop up (0 = none). */
  overshoot: number;
}

export interface StylePost {
  /** Tilt-shift depth of field: sharp band around `focus` (0 = bottom, 1 = top of the screen). */
  tiltShift: { focus: number; range: number; blur: number; tiers: Tier[] } | null;
  ssao: { radius: number; intensity: number; tiers: Tier[] } | null;
  saturation: number;
  vignette: number;
}

export interface StylePopups {
  kind: PopupKind;
  fill: string;
  stroke: string;
  text: string;
  font: string;
}

export interface StylePack {
  id: string;
  name: string;
  description: string;
  shading: ShadingModel;
  palette: StylePalette;
  lighting: StyleLighting;
  terrain: StyleTerrain;
  materials: StyleMaterials;
  props: StyleProps;
  anim: StyleAnim;
  post: StylePost;
  popups: StylePopups;
  fog: { color: string; density: number } | null;
}

export class StylePackError extends Error {}

const HEX = /^#[0-9a-fA-F]{6}$/;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Deep-merges `input` over `base`, checking types against `base`: numbers stay
 * numbers, colour strings stay `#rrggbb`, arrays keep their element type,
 * `null` is allowed where the base allows it. Unknown keys are rejected.
 */
function merge(base: unknown, input: unknown, path: string): unknown {
  if (input === undefined) return base;
  if (input === null) {
    if (base === null || isObj(base)) return null;
    throw new StylePackError(`${path}: null not allowed`);
  }
  if (base === null) return input; // optional block: accept as given (validated by the caller)
  if (Array.isArray(base)) {
    if (!Array.isArray(input) || input.length === 0) throw new StylePackError(`${path}: expected a non-empty array`);
    const proto = base[0];
    return input.map((v, i) => merge(proto, v, `${path}[${i}]`));
  }
  if (isObj(base)) {
    if (!isObj(input)) throw new StylePackError(`${path}: expected an object`);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(input)) if (!(k in base)) throw new StylePackError(`${path}.${k}: unknown key`);
    for (const k of Object.keys(base)) out[k] = merge(base[k], input[k], `${path}.${k}`);
    return out;
  }
  if (typeof base === "number") {
    if (typeof input !== "number" || !Number.isFinite(input)) throw new StylePackError(`${path}: expected a number`);
    return input;
  }
  if (typeof base === "boolean") {
    if (typeof input !== "boolean") throw new StylePackError(`${path}: expected a boolean`);
    return input;
  }
  if (typeof base === "string") {
    if (typeof input !== "string") throw new StylePackError(`${path}: expected a string`);
    if (HEX.test(base) && !HEX.test(input)) throw new StylePackError(`${path}: expected a #rrggbb colour`);
    return input;
  }
  return input;
}

const TIERS: Tier[] = ["low", "medium", "high"];

/** Defaults every pack is merged over (a neutral tabletop look). */
export const DEFAULT_STYLE: StylePack = {
  id: "default",
  name: "Default",
  description: "",
  shading: "pbr",
  palette: {
    background: "#efede8",
    table: "#f2f0ea",
    grass: "#6aab2e",
    grassAlt: "#8cc63a",
    road: "#e9dcb8",
    city: "#c99a63",
    riverBed: "#5c7f86",
    water: "#4f93c8",
    slab: "#e6d6b4",
    seam: "#6b5a3e",
    stone: "#b8ad94",
    stoneDark: "#8e8470",
    roofs: ["#b8442a", "#a83c26", "#c45232", "#9c3a22"],
    plaster: ["#eadfc8", "#e2d4b6", "#efe6d2", "#d9caa8"],
    foliage: ["#23502a", "#2c5e2e", "#1d4424"],
    trunk: "#5b4129",
    wood: "#8a6238",
    dark: "#3a2c22",
    sheep: "#f4f1e8",
    cow: "#6e4c32",
    crop: "#c9b25a",
    players: ["#d42a20", "#2c55c8", "#f1c21b", "#2f8f3a", "#2b2b2b", "#9c4fc0"],
  },
  lighting: {
    sun: { color: "#fff1dc", intensity: 2.6, azimuth: 35, elevation: 52 },
    hemisphere: { sky: "#fdf6ea", ground: "#8a7e62", intensity: 1.1 },
    environment: 0.45,
    exposure: 1,
    toneMapping: "agx",
    shadowSoftness: 3,
  },
  terrain: {
    grassNoise: 0.35,
    noiseScale: 3,
    grain: 0.1,
    seamWidth: 0.012,
    seamDarken: 0.45,
    tileGap: 0.008,
    heightJitter: 0.004,
    ao: 0.5,
    resolution: { low: 24, medium: 40, high: 48 },
  },
  materials: {
    roughness: 0.85,
    metalness: 0,
    figureRoughness: 0.7,
    toonSteps: 3,
    outline: null,
    stoneNoise: 0.25,
  },
  props: { scale: 1, houseHeight: 1, rounded: false },
  anim: { preset: "realistic", speed: 1, squash: 0, overshoot: 0 },
  post: {
    tiltShift: { focus: 0.45, range: 0.3, blur: 3, tiers: ["high"] },
    ssao: { radius: 0.12, intensity: 1, tiers: ["high"] },
    saturation: 1,
    vignette: 0,
  },
  popups: { kind: "coin", fill: "#f3c64a", stroke: "#7a5414", text: "#4a300a", font: "700 64px Georgia, serif" },
  fog: null,
};

/** Validates a parsed style.json and fills defaults. Throws `StylePackError`. */
export function loadStylePack(json: unknown): StylePack {
  if (!isObj(json)) throw new StylePackError("style: expected an object");
  if (typeof json.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(json.id)) throw new StylePackError("style.id: expected a lowercase id");
  if (typeof json.name !== "string" || json.name.length === 0) throw new StylePackError("style.name: required");
  const base = { ...DEFAULT_STYLE, post: { ...DEFAULT_STYLE.post } };
  const out = merge(base, json, "style") as StylePack;
  if (!["pbr", "toon", "flat"].includes(out.shading)) throw new StylePackError(`style.shading: unknown model ${out.shading}`);
  if (!["realistic", "cartoon"].includes(out.anim.preset)) throw new StylePackError(`style.anim.preset: unknown ${out.anim.preset}`);
  if (!["coin", "comic", "bubble"].includes(out.popups.kind)) throw new StylePackError(`style.popups.kind: unknown ${out.popups.kind}`);
  if (!["none", "aces", "agx", "neutral"].includes(out.lighting.toneMapping))
    throw new StylePackError(`style.lighting.toneMapping: unknown ${out.lighting.toneMapping}`);
  if (out.palette.players.length < 5) throw new StylePackError("style.palette.players: need at least 5 colours");
  for (const blk of [out.post.tiltShift, out.post.ssao]) {
    if (blk && !blk.tiers.every((t) => TIERS.includes(t))) throw new StylePackError("style.post: unknown tier");
  }
  const ol = out.materials.outline as unknown;
  if (ol !== null && !(isObj(ol) && typeof ol.color === "string" && HEX.test(ol.color) && typeof ol.thickness === "number"))
    throw new StylePackError("style.materials.outline: expected {color, thickness} or null");
  if (out.fog && (!HEX.test(out.fog.color) || typeof out.fog.density !== "number")) throw new StylePackError("style.fog: expected {color, density}");
  return out;
}

export const STYLE_IDS = ["tabletop", "cartoon", "diorama"] as const;
export type BuiltinStyleId = (typeof STYLE_IDS)[number];

/** The built-in 3D style packs, validated at module load. */
export const STYLE_PACKS: Record<BuiltinStyleId, StylePack> = {
  tabletop: loadStylePack(tabletopJson),
  cartoon: loadStylePack(cartoonJson),
  diorama: loadStylePack(dioramaJson),
};

export const DEFAULT_STYLE_ID: BuiltinStyleId = "tabletop";

export function getStylePack(id: string): StylePack {
  const p = (STYLE_PACKS as Record<string, StylePack>)[id];
  if (!p) throw new StylePackError(`unknown style ${id}`);
  return p;
}

/** Whether a post effect block is enabled at a tier. */
export function effectOn(block: { tiers: Tier[] } | null, tier: Tier): boolean {
  return !!block && block.tiers.includes(tier);
}
