// Board palettes for the 2D renderers. Classic and Blueprint are the same drawing
// code with different data (PRD §6.3: "a style pack is data, not code").

import type { PlayerColorId } from "@carcassonne/game-client";

export interface BoardPalette {
  id: string;
  /** CSS background of the table behind the board. */
  table: string;
  /** Optional grid drawn behind tiles (in board units). */
  grid?: { major: string; minor: string };
  tile: { field: string; fieldShade: string; border: string; borderWidth: number };
  city: { fill: string; shade: string; wall: string; wallWidth: number; crenel: string; hatch?: string };
  road: { casing: string; fill: string; casingWidth: number; fillWidth: number; dash?: string };
  river: { fill: string; edge?: string; ripple?: string };
  garden?: { fill: string; hedge: string; bloom: string };
  building: { body: string; roof: string; outline: string };
  pennant: { fill: string; stroke: string; mark: string };
  target: { fill: string; stroke: string; hover: string };
  highlight: { stroke: string; fill: string };
  figureOutline: string;
  ink: string;
  /** Player colours may be adjusted per palette for contrast. */
  players?: Partial<Record<PlayerColorId, string>>;
  /** Painted (bitmap) tile art; palettes without it draw vector line art. */
  illustrated?: IllustratedPalette;
}

/**
 * Colours of the painted Classic tiles (./illustrated). Pure data: tweak freely.
 * Pairs are [light, dark]; lighting comes from the top-left.
 */
export interface IllustratedPalette {
  /** Grass: mottling runs dark → base → light; blades and tufts use the accents. */
  grass: { dark: string; base: string; light: string; blade: string; tuft: string; flowers: string[] };
  /** Ochre city ground. */
  ground: { dark: string; base: string; light: string; speck: string };
  road: { edge: string; base: string; light: string; rut: string };
  water: { bank: string; deep: string; base: string; light: string; ripple: string };
  /** City wall: lit top, shaded outer face, dark mortar/crenel ticks. */
  wall: { top: string; topLight: string; face: string; faceDark: string; tick: string; outline: string };
  /** House walls (cream), lit and shaded faces. */
  house: { light: string; base: string; shade: string; window: string; outline: string };
  /** Roof tints, indexed by geo `tint` (light half, dark half). */
  roofs: [string, string][];
  /** Tower roofs (the blue conical / pyramid caps). */
  towerRoof: [string, string];
  tree: { dark: string; base: string; light: string; trunk: string };
  bush: { dark: string; base: string; light: string };
  crop: { a: string; b: string; edge: string };
  hedge: { dark: string; base: string; light: string };
  gravel: { base: string; edge: string };
  sheep: string;
  cow: [string, string];
  pennant: { field: string; check: string; rim: string };
  shadow: string;
  /** Tile edge bevel. */
  bevel: { light: string; dark: string };
}

export const CLASSIC_ILLUSTRATED: IllustratedPalette = {
  grass: {
    dark: "#5f9a24",
    base: "#86bf35",
    light: "#a9d653",
    blade: "#c4e47a",
    tuft: "#4f8a1e",
    flowers: ["#fff6d8", "#ffe066", "#f7a8c0", "#ffffff"],
  },
  ground: { dark: "#c48f4a", base: "#ddb067", light: "#efcf91", speck: "#a87438" },
  road: { edge: "#9a7a4e", base: "#efe6cc", light: "#fbf6e6", rut: "#d9cba6" },
  water: { bank: "#4d7f3a", deep: "#5f9fcf", base: "#8cc3e6", light: "#c3e3f5", ripple: "#f2fbff" },
  wall: { top: "#e8dcc0", topLight: "#f7f0de", face: "#bcae90", faceDark: "#97886c", tick: "#8a7a5f", outline: "#5e5142" },
  house: { light: "#fbf3df", base: "#eadcbc", shade: "#c8b48e", window: "#5a4630", outline: "#6b5238" },
  roofs: [
    ["#ec6a3b", "#b8401f"],
    ["#e2552f", "#a83418"],
    ["#f0804a", "#c0532a"],
    ["#d9603a", "#9c3b20"],
  ],
  towerRoof: ["#5f86d0", "#2f4f95"],
  tree: { dark: "#2c5a1c", base: "#3f7a26", light: "#6aa53a", trunk: "#6b4a2a" },
  bush: { dark: "#244d18", base: "#356c22", light: "#5a9433" },
  crop: { a: "#e0c35c", b: "#c9a840", edge: "#a88b35" },
  hedge: { dark: "#2a5a1d", base: "#3f7d2a", light: "#68a542" },
  gravel: { base: "#e9dcb8", edge: "#b9a57a" },
  sheep: "#fbfaf3",
  cow: ["#7a4e2e", "#f3eee2"],
  pennant: { field: "#2f5fb8", check: "#f6f3ea", rim: "#1d3a75" },
  shadow: "rgba(28, 40, 10, 0.34)",
  bevel: { light: "rgba(255, 255, 240, 0.2)", dark: "rgba(40, 30, 10, 0.26)" },
};

export const CLASSIC_PALETTE: BoardPalette = {
  id: "classic",
  table:
    "radial-gradient(ellipse at 50% 40%, #c79a62 0%, #a4743f 55%, #7a5129 100%)",
  tile: { field: "#86bf35", fieldShade: "#78ae2e", border: "#4f7a22", borderWidth: 0.8 },
  city: { fill: "#d4a35a", shade: "#c08d48", wall: "#e8dcc0", wallWidth: 4.5, crenel: "#97886c" },
  road: { casing: "#9a7a4e", fill: "#efe6cc", casingWidth: 10, fillWidth: 7.5 },
  river: { fill: "#8cc3e6", edge: "#4d7f3a", ripple: "rgba(235, 248, 255, 0.55)" },
  garden: { fill: "#6f9c47", hedge: "#3f6a2a", bloom: "#f4d35e" },
  building: { body: "#f1e6cc", roof: "#b5523b", outline: "#5c4a35" },
  pennant: { fill: "#2f5fa8", stroke: "#f6efdc", mark: "#f6efdc" },
  target: { fill: "rgba(255, 244, 214, 0.18)", stroke: "rgba(255, 244, 214, 0.85)", hover: "rgba(255, 244, 214, 0.42)" },
  highlight: { stroke: "#fff3c4", fill: "rgba(255, 236, 160, 0.45)" },
  figureOutline: "#2b2117",
  ink: "#2b2117",
  illustrated: CLASSIC_ILLUSTRATED,
};

export const BLUEPRINT_PALETTE: BoardPalette = {
  id: "blueprint",
  table: "#0b1d36",
  grid: { major: "rgba(120, 180, 255, 0.16)", minor: "rgba(120, 180, 255, 0.07)" },
  tile: { field: "#0f2747", fieldShade: "#0f2747", border: "rgba(140, 200, 255, 0.55)", borderWidth: 0.7 },
  city: { fill: "#163a66", shade: "#163a66", wall: "#e8f3ff", wallWidth: 2, crenel: "#e8f3ff", hatch: "rgba(200, 228, 255, 0.35)" },
  road: { casing: "#9fd3ff", fill: "#0f2747", casingWidth: 7, fillWidth: 4.2 },
  river: { fill: "#163a66", edge: "#3d8bd9", ripple: "rgba(159, 211, 255, 0.5)" },
  garden: { fill: "#0f2747", hedge: "#7fe0a8", bloom: "#ffd166" },
  building: { body: "#0f2747", roof: "#0f2747", outline: "#e8f3ff" },
  pennant: { fill: "#0f2747", stroke: "#ffd166", mark: "#ffd166" },
  target: { fill: "rgba(255, 209, 102, 0.08)", stroke: "rgba(255, 209, 102, 0.9)", hover: "rgba(255, 209, 102, 0.3)" },
  highlight: { stroke: "#ffd166", fill: "rgba(255, 209, 102, 0.25)" },
  figureOutline: "#e8f3ff",
  ink: "#e8f3ff",
  players: { black: "#a8b3c4" },
};

export type MarkerShape = "circle" | "square" | "triangle" | "diamond" | "star" | "cross";

export interface PlayerAppearance {
  id: PlayerColorId;
  label: string;
  fill: string;
  /** Text/marker colour drawn on top of `fill`. */
  ink: string;
  marker: MarkerShape;
}

/** Colour-blind-aware meeple colours; each also carries a distinct shape marker. */
export const PLAYER_COLORS: Record<PlayerColorId, PlayerAppearance> = {
  red: { id: "red", label: "Red", fill: "#d4483b", ink: "#fff7ec", marker: "circle" },
  blue: { id: "blue", label: "Blue", fill: "#2f6fc4", ink: "#f2f7ff", marker: "square" },
  yellow: { id: "yellow", label: "Yellow", fill: "#f2c230", ink: "#3a2a00", marker: "triangle" },
  green: { id: "green", label: "Green", fill: "#2e9a5b", ink: "#effff5", marker: "diamond" },
  black: { id: "black", label: "Black", fill: "#33302c", ink: "#f4efe6", marker: "star" },
  pink: { id: "pink", label: "Pink", fill: "#e07bb4", ink: "#3b0d26", marker: "cross" },
};

export const PLAYER_COLOR_ORDER: PlayerColorId[] = ["red", "blue", "yellow", "green", "black", "pink"];

export function playerFill(palette: BoardPalette, color: PlayerColorId): string {
  return palette.players?.[color] ?? PLAYER_COLORS[color].fill;
}
