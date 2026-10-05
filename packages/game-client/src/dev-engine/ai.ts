// TEMPORARY greedy bot for the dev engine (one-ply search + heuristics).
// The real bots live in packages/core/src/ai (Easy→Expert, MCTS).

import type { AiTier, FigureOption, Move, Placement } from "@carcassonne/protocol";

import {
  analyzeBoard,
  cellKey,
  type Board,
  type BoardAnalysis, extentPoints, fieldPoints, legalFiguresOn, neighbourCount } from "../board";
import { Rng } from "./rng";
import { abbotOnBoard, cloneGame, legalPlacements, placeAndScore, type DevGame } from "./rules";

const NOISE: Record<AiTier, number> = { easy: 4, medium: 1, hard: 0.3, expert: 0.1 };

/** Score delta for me minus a share of the best opponent's delta. */
function gainOf(g: DevGame, move: Move): number {
  const me = g.current;
  const sim = cloneGame(g);
  placeAndScore(sim, move, []);
  const gains = sim.players.map((p, i) => p.score - g.players[i]!.score);
  const opp = Math.max(0, ...gains.filter((_, i) => i !== me));
  return gains[me]! - 0.6 * opp;
}

/** Heuristic value of putting a figure on feature `opt` after placing `p`. */
function figureValue(g: DevGame, p: Placement, opt: FigureOption, board: Board, analysis: BoardAnalysis): number {
  const ext = analysis.extentOf(p.x, p.y, opt.feature)!;
  const me = g.players[g.current]!;
  const tilesLeft = g.deck.length;
  if (ext.complete) return extentPoints(ext, board, g.ruleset, false); // scores now, figure returns
  let v = 0;
  switch (ext.kind) {
    case "road":
      v = ext.cells.length * 0.9 - ext.openPorts * 0.3;
      break;
    case "city":
      v = ext.cells.length * 1.6 + ext.pennants * 1.5 - ext.openPorts * 0.15;
      break;
    case "cloister":
    case "garden":
      v = neighbourCount(board, p.x, p.y) * 0.9 + 1 + (opt.type === "abbot" ? 0.5 : 0);
      break;
    case "field":
      v = fieldPoints(ext, analysis) * 0.8 + ext.adjacentCities.length * 1.2 - (tilesLeft > 40 ? 3 : 0);
      break;
  }
  if (opt.type === "meeple") v -= me.meeples <= 2 ? 4 : 1.8;
  return v;
}

export function chooseMove(g: DevGame, tier: AiTier, seed: bigint): Move {
  const rng = new Rng(seed ^ BigInt(g.ply * 7919));
  const placements: Placement[] = legalPlacements(g);
  if (!placements.length) throw new Error("no legal placement");
  const abbot = g.ruleset.abbot ? abbotOnBoard(g.board, g.current) : null;
  const canRecall = !!abbot && (neighbourCount(g.board, abbot.x, abbot.y) >= 6 || g.deck.length < 6);
  let best: Move | null = null;
  let bestScore = -Infinity;
  const noise = NOISE[tier] ?? 1;
  const consider = (move: Move, s: number) => {
    s += (rng.float() - 0.5) * noise;
    if (s > bestScore) {
      bestScore = s;
      best = move;
    }
  };
  for (const p of placements) {
    const base = gainOf(g, { ...p, figure: null });
    consider({ ...p, figure: null }, base);
    const options = legalFiguresOn(g.board, g.catalog, g.currentTile!, p, g.players[g.current]!, g.ruleset);
    if (options.length) {
      const board = new Map(g.board);
      board.set(cellKey(p.x, p.y), { x: p.x, y: p.y, rot: p.rot, tile: g.currentTile!, figures: [] });
      const analysis = analyzeBoard(board, g.catalog);
      for (const opt of options) consider({ ...p, figure: opt }, base + figureValue(g, p, opt, board, analysis));
    }
    if (canRecall) {
      const move: Move = { ...p, figure: { type: "recallAbbot", x: abbot!.x, y: abbot!.y } };
      consider(move, gainOf(g, move));
    }
  }
  return best!;
}
