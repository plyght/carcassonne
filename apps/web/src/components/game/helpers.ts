"use client";

import { useSyncExternalStore } from "react";

import type { EngineEvent, FeatureKind } from "@carcassonne/protocol";
import type { FeatureExtent, GameClient, GameClientState, PlayerMeta } from "@carcassonne/game-client";
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

export const FIGURE_ROLE: Record<FeatureKind, string> = {
  road: "thief",
  city: "knight",
  field: "farmer",
  cloister: "monk",
  garden: "abbot",
  river: "—",
};

export function playerName(players: PlayerMeta[], i: number | null | undefined): string {
  if (i === null || i === undefined) return "Spectator";
  return players[i]?.name ?? `Player ${i + 1}`;
}

export function playerColor(players: PlayerMeta[], i: number): string {
  return PLAYER_COLORS[players[i]?.color ?? "red"].fill;
}

export function describeEvent(e: EngineEvent, players: PlayerMeta[]): string | null {
  switch (e.type) {
    case "tileDiscarded":
      return `Tile ${e.tile} could not be placed and was discarded`;
    case "figurePlaced":
      return `${playerName(players, e.player)} placed ${e.figure === "abbot" ? "the abbot" : "a meeple"}`;
    case "featureScored": {
      if (!e.winners.length || !e.points) return null;
      const who = e.winners.map((w) => playerName(players, w)).join(" & ");
      return `${who} scored ${e.points} for ${e.kind === "field" ? "a field" : `${e.final ? "an unfinished" : "a completed"} ${FEATURE_LABEL[e.kind]}`}`;
    }
    case "abbotRecalled":
      return `${playerName(players, e.player)} recalled the abbot for ${e.points}`;
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
