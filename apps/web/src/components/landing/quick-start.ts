"use client";

// "Play now": a vs-AI game with sensible defaults in one click: you against two
// Medium bots, standard rules (the current box: base game + The River + The Abbot).

import { randomSeedString, type PlayerMeta } from "@carcassonne/game-client";
import { DEFAULT_RULESET } from "@carcassonne/protocol";

import { botName } from "@/components/setup/seat-editor";
import { createLocalGame } from "@/lib/local-games";

export const QUICK_GAME_SEATS: PlayerMeta[] = [
  { name: "You", color: "red", kind: "human" },
  { name: botName(1), color: "blue", kind: "bot", tier: "medium" },
  { name: botName(2), color: "yellow", kind: "bot", tier: "medium" },
];

/** Create the quick game and return its route. */
export function createQuickGame(): `/play/local/${string}` {
  const rec = createLocalGame({
    mode: "ai",
    ruleset: { ...DEFAULT_RULESET },
    seed: randomSeedString(),
    players: QUICK_GAME_SEATS.map((s) => ({ ...s })),
    engine: "core-wasm",
  });
  return `/play/local/${rec.id}`;
}
