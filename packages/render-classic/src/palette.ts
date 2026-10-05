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
  river: { fill: string };
  building: { body: string; roof: string; outline: string };
  pennant: { fill: string; stroke: string; mark: string };
  target: { fill: string; stroke: string; hover: string };
  highlight: { stroke: string; fill: string };
  figureOutline: string;
  ink: string;
  /** Player colours may be adjusted per palette for contrast. */
  players?: Partial<Record<PlayerColorId, string>>;
}

export const CLASSIC_PALETTE: BoardPalette = {
  id: "classic",
  table:
    "radial-gradient(ellipse at 50% 40%, #c79a62 0%, #a4743f 55%, #7a5129 100%)",
  tile: { field: "#93b65a", fieldShade: "#86a94f", border: "#5f7a33", borderWidth: 0.8 },
  city: { fill: "#e3c88f", shade: "#d4b274", wall: "#8a7356", wallWidth: 4.5, crenel: "#6d5a43" },
  road: { casing: "#8e7a5c", fill: "#f3ead2", casingWidth: 10, fillWidth: 6.5 },
  river: { fill: "#5aa5d6" },
  building: { body: "#f1e6cc", roof: "#b5523b", outline: "#5c4a35" },
  pennant: { fill: "#2f5fa8", stroke: "#f6efdc", mark: "#f6efdc" },
  target: { fill: "rgba(255, 244, 214, 0.18)", stroke: "rgba(255, 244, 214, 0.85)", hover: "rgba(255, 244, 214, 0.42)" },
  highlight: { stroke: "#fff3c4", fill: "rgba(255, 236, 160, 0.45)" },
  figureOutline: "#2b2117",
  ink: "#2b2117",
};

export const BLUEPRINT_PALETTE: BoardPalette = {
  id: "blueprint",
  table: "#0b1d36",
  grid: { major: "rgba(120, 180, 255, 0.16)", minor: "rgba(120, 180, 255, 0.07)" },
  tile: { field: "#0f2747", fieldShade: "#0f2747", border: "rgba(140, 200, 255, 0.55)", borderWidth: 0.7 },
  city: { fill: "#163a66", shade: "#163a66", wall: "#e8f3ff", wallWidth: 2, crenel: "#e8f3ff", hatch: "rgba(200, 228, 255, 0.35)" },
  road: { casing: "#9fd3ff", fill: "#0f2747", casingWidth: 7, fillWidth: 4.2 },
  river: { fill: "#3d8bd9" },
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
