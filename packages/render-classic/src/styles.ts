// Style system scaffolding (PRD §6.3). A style pack is data; the renderer picks the
// drawing backend from `renderer`. 2D packs (classic, blueprint) work today; the 3D
// packs are registered as "coming soon" so the settings UI and persistence are real.
// When packages/assets lands, these entries move to assets/styles/<id>/style.json.

import { BLUEPRINT_PALETTE, CLASSIC_PALETTE, type BoardPalette } from "./palette";

export type StyleId = "tabletop" | "classic" | "cartoon" | "diorama" | "storybook" | "blueprint";

/** How you look at the board; every 3D style supports every camera. */
export type CameraMode = "top-down" | "tabletop" | "orbit" | "cinematic";

export const CAMERA_MODES: { id: CameraMode; label: string; description: string }[] = [
  { id: "top-down", label: "Top-down", description: "Orthographic map view. 2D styles lock to this." },
  { id: "tabletop", label: "Tabletop", description: "Tilted perspective, like sitting at the table." },
  { id: "orbit", label: "Free orbit", description: "Drag to circle the board freely." },
  { id: "cinematic", label: "Cinematic", description: "Follows the action and frames scoring moments." },
];

export type ShadingModel = "flat" | "pbr" | "toon" | "paint";

export interface StylePack {
  id: StyleId;
  name: string;
  tagline: string;
  description: string;
  dimension: "2d" | "3d";
  /** Which renderer draws it. */
  renderer: "classic-svg" | "three";
  status: "ready" | "coming-soon";
  /** Milestone in the PRD plan. */
  ships: string;
  shading: ShadingModel;
  cameras: CameraMode[];
  defaultCamera: CameraMode;
  animation: { intensity: number; easing: "realistic" | "overshoot" | "gentle" | "none" };
  postFx: string[];
  /** 2D palette (classic-svg renderer only). */
  palette?: BoardPalette;
  /** Swatch colours for previews of styles that cannot render yet. */
  swatch: [string, string, string];
}

const ALL_CAMERAS: CameraMode[] = ["top-down", "tabletop", "orbit", "cinematic"];

export const STYLE_PACKS: StylePack[] = [
  {
    id: "classic",
    name: "Classic Board",
    tagline: "Crisp flat tiles, like the printed game",
    description: "Clean outlines, green fields, walled tan cities with pennant shields and flat meeple tokens. Fastest and clearest.",
    dimension: "2d",
    renderer: "classic-svg",
    status: "ready",
    ships: "M2–M3",
    shading: "flat",
    cameras: ["top-down"],
    defaultCamera: "top-down",
    animation: { intensity: 0.6, easing: "gentle" },
    postFx: [],
    palette: CLASSIC_PALETTE,
    swatch: ["#93b65a", "#e3c88f", "#f3ead2"],
  },
  {
    id: "blueprint",
    name: "Blueprint",
    tagline: "Line art on a dark grid, maximum legibility",
    description: "Minimal high-contrast line art. Doubles as the accessibility style.",
    dimension: "2d",
    renderer: "classic-svg",
    status: "ready",
    ships: "M8",
    shading: "flat",
    cameras: ["top-down"],
    defaultCamera: "top-down",
    animation: { intensity: 0.3, easing: "gentle" },
    postFx: [],
    palette: BLUEPRINT_PALETTE,
    swatch: ["#0b1d36", "#9fd3ff", "#ffd166"],
  },
  {
    id: "tabletop",
    name: "Tabletop",
    tagline: "Wooden table, cardboard tiles, a living diorama",
    description: "PBR wood and linen-textured tiles under warm light. Placed tiles rise into relief: walls, bells, carts and sheep.",
    dimension: "3d",
    renderer: "three",
    status: "coming-soon",
    ships: "M3",
    shading: "pbr",
    cameras: ALL_CAMERAS,
    defaultCamera: "tabletop",
    animation: { intensity: 1, easing: "realistic" },
    postFx: ["tonemap", "ssao"],
    swatch: ["#7a5129", "#d9c7a3", "#4f7d3a"],
  },
  {
    id: "cartoon",
    name: "Cartoon",
    tagline: "Cel-shaded, bouncy and loud",
    description: "Saturated colours, ink outlines, squash-and-stretch meeples and comic score pops.",
    dimension: "3d",
    renderer: "three",
    status: "coming-soon",
    ships: "M3–M5",
    shading: "toon",
    cameras: ALL_CAMERAS,
    defaultCamera: "tabletop",
    animation: { intensity: 1.4, easing: "overshoot" },
    postFx: ["outline"],
    swatch: ["#ffcf3f", "#3fb5ff", "#ff5d73"],
  },
  {
    id: "diorama",
    name: "Living Diorama",
    tagline: "A tilt-shift miniature world",
    description: "Soft pastels, depth of field, villagers and sheep, day/night and weather.",
    dimension: "3d",
    renderer: "three",
    status: "coming-soon",
    ships: "M8",
    shading: "pbr",
    cameras: ALL_CAMERAS,
    defaultCamera: "tabletop",
    animation: { intensity: 0.9, easing: "gentle" },
    postFx: ["tonemap", "dof"],
    swatch: ["#b9d8c2", "#f5d6c6", "#a7c4e8"],
  },
  {
    id: "storybook",
    name: "Storybook",
    tagline: "Watercolour paper and hand-inked edges",
    description: "Painterly post-processing and illustrated score cards.",
    dimension: "3d",
    renderer: "three",
    status: "coming-soon",
    ships: "M8 (stretch)",
    shading: "paint",
    cameras: ALL_CAMERAS,
    defaultCamera: "tabletop",
    animation: { intensity: 0.7, easing: "gentle" },
    postFx: ["paper-grain", "outline"],
    swatch: ["#f3e9d2", "#8fb7a2", "#c46d5e"],
  },
];

export const STYLE_REGISTRY: ReadonlyMap<StyleId, StylePack> = new Map(STYLE_PACKS.map((s) => [s.id, s]));

export const DEFAULT_STYLE: StyleId = "classic";

export function getStyle(id: string | null | undefined): StylePack {
  return STYLE_REGISTRY.get(id as StyleId) ?? STYLE_REGISTRY.get(DEFAULT_STYLE)!;
}

/** The style actually used to draw: unfinished styles fall back to Classic (the guaranteed fallback). */
export function renderableStyle(id: StyleId): StylePack {
  const s = getStyle(id);
  return s.status === "ready" ? s : getStyle(DEFAULT_STYLE);
}

/** Clamp a camera to what the style supports. */
export function effectiveCamera(style: StylePack, camera: CameraMode): CameraMode {
  return style.cameras.includes(camera) ? camera : style.defaultCamera;
}
