"use client";

import { useSyncExternalStore } from "react";

import type { EngineEvent, FeatureKind, FieldEdition } from "@carcassonne/protocol";
import { explainScore, playerName, type FeatureExtent, type GameClient, type GameClientState, type PlayerMeta } from "@carcassonne/game-client";
import { PLAYER_COLORS } from "@carcassonne/render-classic";

export function useClientState(client: GameClient): GameClientState {
  return useSyncExternalStore(client.subscribe, client.getState, client.getState);
}

export const FEATURE_LABEL: Record<FeatureKind, string> = {
  road: "road",
  city: "city",
  field: "field",
  cloister: "cloister",
  garden: "garden",
  river: "river",
};

export { FIGURE_ROLE, playerName } from "@carcassonne/game-client";

export function playerColor(players: PlayerMeta[], i: number): string {
  return PLAYER_COLORS[players[i]?.color ?? "red"].fill;
}

/** One event as a plain sentence (replays); live games narrate whole moves (narrateBatch). */
export function describeEvent(e: EngineEvent, players: PlayerMeta[], edition: FieldEdition = 3): string | null {
  switch (e.type) {
    case "tileDiscarded":
      return `Tile ${e.tile} fit nowhere, so it was set aside`;
    case "figurePlaced":
      return `${playerName(players, e.player)} placed ${e.figure === "abbot" ? "the abbot" : "a meeple"}`;
    case "featureScored":
      return explainScore(e, players, edition);
    case "abbotRecalled":
      return `${playerName(players, e.player)} brought the abbot home for ${e.points}`;
    case "gameEnded":
      return "Game over: final scoring done";
    default:
      return null;
  }
}

export interface Projection {
  kind: FeatureKind;
  tiles: number;
  pennants: number;
  complete: boolean;
  holders: number[];
  ifCompleted: number | null;
  atEnd: number;
}

export function projectExtent(ext: FeatureExtent, neighbours: number, completedCities: number, edition: 1 | 2 | 3): Projection {
  const tiles = ext.cells.length;
  const holders = [...new Set(ext.figures.map((f) => f.player))];
  let ifCompleted: number | null = null;
  let atEnd = 0;
  switch (ext.kind) {
    case "road":
      ifCompleted = tiles;
      atEnd = tiles;
      break;
    case "city":
      ifCompleted = edition === 1 && tiles === 2 ? 2 + ext.pennants : 2 * tiles + 2 * ext.pennants;
      atEnd = tiles + ext.pennants;
      break;
    case "cloister":
    case "garden":
      ifCompleted = 9;
      atEnd = 1 + neighbours;
      break;
    case "field":
      atEnd = edition === 1 ? 4 * completedCities : 3 * completedCities;
      break;
  }
  return { kind: ext.kind, tiles, pennants: ext.pennants, complete: ext.complete, holders, ifCompleted, atEnd };
}

export function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
