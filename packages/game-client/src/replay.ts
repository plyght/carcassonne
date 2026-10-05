// Replays are (engine, ruleset, seed, players, moves[]) and are re-simulated on
// demand (PRD §6.9). The viewer scrubs by folding event batches over the start view.

import type { EngineEvent, GameView, Move, Ruleset } from "@carcassonne/protocol";

import { applyEvents } from "./apply-events";
import type { PlayerMeta } from "./client";
import { seedFromString, type AsyncEngine } from "./engine-port";
import type { TileCatalog } from "./tiles";

export interface ReplayRecord {
  id: string;
  engine: string;
  ruleset: Ruleset;
  seed: string;
  players: PlayerMeta[];
  moves: Move[];
  startedAt: number;
  finishedAt: number | null;
  scores: number[];
}

export interface SimulatedReplay {
  initial: GameView;
  /** Event batch produced by each move (index = ply). */
  plies: EngineEvent[][];
  /** Mover of each ply. */
  movers: number[];
}

export async function simulateReplay(engine: AsyncEngine, r: ReplayRecord): Promise<SimulatedReplay> {
  const h = await engine.createGame(r.ruleset, seedFromString(r.seed), r.players.length);
  try {
    const initial = await engine.view(h);
    const plies: EngineEvent[][] = [];
    const movers: number[] = [];
    let current = initial.currentPlayer;
    for (const m of r.moves) {
      const res = await engine.apply(h, m);
      if (!res.ok) throw new Error(`replay diverged at ply ${plies.length}: ${res.error}`);
      plies.push(res.events);
      movers.push(current);
      for (const e of res.events) if (e.type === "turnStarted") current = e.player;
    }
    return { initial, plies, movers };
  } finally {
    await engine.freeGame(h);
  }
}

/** View after the first `ply` moves. */
export function viewAtPly(rep: SimulatedReplay, ply: number, catalog?: TileCatalog): GameView {
  let v = rep.initial;
  const n = Math.max(0, Math.min(ply, rep.plies.length));
  for (let i = 0; i < n; i++) v = applyEvents(v, rep.plies[i]!, catalog);
  return v;
}
