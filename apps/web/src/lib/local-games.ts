"use client";

import type { Move, Ruleset } from "@carcassonne/protocol";
import type { PlayerMeta, ReplayRecord } from "@carcassonne/game-client";

import { readJSON, writeJSON } from "./storage";

export type LocalMode = "ai" | "hotseat" | "tutorial";

export interface LocalGameRecord extends ReplayRecord {
  mode: LocalMode;
  status: "playing" | "ended";
  updatedAt: number;
}

const KEY = "carc.local-games.v1";
const MAX = 40;

function all(): Record<string, LocalGameRecord> {
  return readJSON<Record<string, LocalGameRecord>>(KEY, {});
}

export function listGames(): LocalGameRecord[] {
  return Object.values(all()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getGame(id: string): LocalGameRecord | null {
  return all()[id] ?? null;
}

export function saveGame(rec: LocalGameRecord) {
  const games = all();
  games[rec.id] = rec;
  const sorted = Object.values(games).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX);
  writeJSON(KEY, Object.fromEntries(sorted.map((g) => [g.id, g])));
}

export function deleteGame(id: string) {
  const games = all();
  delete games[id];
  writeJSON(KEY, games);
}

export function newGameId(): string {
  const a = Math.random().toString(36).slice(2, 8);
  return `${Date.now().toString(36)}-${a}`;
}

export function createLocalGame(opts: {
  mode: LocalMode;
  ruleset: Ruleset;
  seed: string;
  players: PlayerMeta[];
  engine: string;
}): LocalGameRecord {
  const now = Date.now();
  const rec: LocalGameRecord = {
    id: newGameId(),
    mode: opts.mode,
    engine: opts.engine,
    ruleset: opts.ruleset,
    seed: opts.seed,
    players: opts.players,
    moves: [] as Move[],
    startedAt: now,
    finishedAt: null,
    scores: [],
    status: "playing",
    updatedAt: now,
  };
  saveGame(rec);
  return rec;
}
