// TEMPORARY TypeScript reference rules, good enough to play the base game until
// @carcassonne/core-wasm lands. Covers: edge-matched tile placement, discards,
// meeple placement on roads/cities/cloisters/fields, the abbot on cloisters (+ recall),
// completion scoring, end-game scoring for incomplete features and fields (all
// three editions). Not covered: River, gardens, hand size > 1.

import type {
  BoardTile,
  EngineEvent,
  FeatureKind,
  FigureAction,
  FigureOption,
  GameView,
  Move,
  Placement,
  PlayerIndex,
  PlayerView,
  Ruleset,
  TileId,
} from "@carcassonne/protocol";

import {
  analyzeBoard,
  cellKey,
  extentPoints,
  fieldPoints,
  findAbbot,
  legalFiguresOn,
  legalPlacementsOn,
  majority,
  type Board,
  type BoardAnalysis,
  type FeatureExtent,
} from "../board";
import type { TileCatalog } from "../tiles";
import { Rng } from "./rng";
import { START_TILE } from "./tiles-base";

export const MEEPLES_PER_PLAYER = 7;

export interface DevGame {
  ruleset: Ruleset;
  catalog: TileCatalog;
  rng: Rng;
  deck: TileId[];
  board: Board;
  players: PlayerView[];
  current: PlayerIndex;
  currentTile: TileId | null;
  ply: number;
  status: "playing" | "ended";
  remaining: Record<TileId, number>;
}

const emptyBreakdown = () => ({ road: 0, city: 0, cloister: 0, garden: 0, field: 0 });

export function newGame(ruleset: Ruleset, catalog: TileCatalog, seed: bigint, players: number): DevGame {
  if (players < 1 || players > 6) throw new Error(`bad player count ${players}`);
  const rng = new Rng(seed);
  const deck: TileId[] = [];
  for (const def of catalog.all()) {
    if (def.set !== "base") continue;
    const copies = def.id === START_TILE ? def.count - 1 : def.count;
    for (let i = 0; i < copies; i++) deck.push(def.id);
  }
  rng.shuffle(deck);
  const remaining: Record<TileId, number> = {};
  for (const id of deck) remaining[id] = (remaining[id] ?? 0) + 1;
  const board: Board = new Map();
  board.set(cellKey(0, 0), { x: 0, y: 0, rot: 0, tile: START_TILE, figures: [] });
  const game: DevGame = {
    ruleset,
    catalog,
    rng,
    deck,
    board,
    players: Array.from({ length: players }, () => ({
      score: 0,
      meeples: MEEPLES_PER_PLAYER,
      abbotAvailable: ruleset.abbot,
      breakdown: emptyBreakdown(),
    })),
    current: 0,
    currentTile: null,
    ply: 0,
    status: "playing",
    remaining,
  };
  drawTile(game, []);
  return game;
}

export function cloneGame(g: DevGame): DevGame {
  const board: Board = new Map();
  for (const [k, t] of g.board) board.set(k, { ...t, figures: t.figures.map((f) => ({ ...f })) });
  return {
    ...g,
    rng: Rng.restore(g.rng.state()),
    deck: [...g.deck],
    board,
    players: g.players.map((p) => ({ ...p, breakdown: { ...p.breakdown } })),
    remaining: { ...g.remaining },
  };
}

export function viewOf(g: DevGame): GameView {
  return {
    ply: g.ply,
    status: g.status,
    ruleset: { ...g.ruleset },
    players: g.players.map((p) => ({ ...p, breakdown: { ...p.breakdown } })),
    currentPlayer: g.current,
    currentTile: g.currentTile,
    board: [...g.board.values()].map((t) => ({ ...t, figures: t.figures.map((f) => ({ ...f })) })),
    remaining: Object.fromEntries(Object.entries(g.remaining).filter(([, n]) => n > 0)),
  };
}

export function legalPlacements(g: DevGame): Placement[] {
  if (g.status !== "playing" || !g.currentTile) return [];
  return legalPlacementsOn(g.board, g.catalog, g.currentTile);
}

export function legalFigures(g: DevGame, p: Placement): FigureOption[] {
  if (!g.currentTile) return [];
  if (!legalPlacements(g).some((q) => q.x === p.x && q.y === p.y && q.rot === p.rot)) return [];
  return legalFiguresOn(g.board, g.catalog, g.currentTile, p, g.players[g.current]!, g.ruleset);
}

export const abbotOnBoard = findAbbot;

function award(g: DevGame, winners: PlayerIndex[], kind: FeatureKind, points: number) {
  if (points <= 0) return;
  const bucket = kind === "river" ? "road" : kind;
  for (const w of winners) {
    const p = g.players[w]!;
    p.score += points;
    p.breakdown[bucket] += points;
  }
}

function returnFigures(g: DevGame, ext: FeatureExtent) {
  for (const f of ext.figures) {
    const key = cellKey(f.x, f.y);
    const t = g.board.get(key)!;
    g.board.set(key, {
      ...t,
      figures: t.figures.filter((x) => !(x.feature === f.feature && x.player === f.player && x.figure === f.figure)),
    });
    const p = g.players[f.player]!;
    if (f.figure === "abbot") p.abbotAvailable = true;
    else p.meeples++;
  }
}

function scoreExtent(g: DevGame, ext: FeatureExtent, final: boolean, events: EngineEvent[]) {
  const winners = majority(ext.figures);
  const points = extentPoints(ext, g.board, g.ruleset, final);
  award(g, winners, ext.kind, points);
  events.push({
    type: "featureScored",
    kind: ext.kind,
    cells: ext.cells.map(([x, y]) => [x, y] as [number, number]),
    winners,
    points,
    returned: ext.figures.map((f) => ({ ...f })),
    final,
  });
  returnFigures(g, ext);
}

function validateFigure(g: DevGame, move: Move): string | null {
  const fig: FigureAction = move.figure;
  if (fig === null) return null;
  if (fig.type === "recallAbbot") {
    if (!g.ruleset.abbot) return "abbot not in play";
    const a = abbotOnBoard(g.board, g.current);
    if (!a || a.x !== fig.x || a.y !== fig.y) return "no abbot to recall there";
    return null;
  }
  const ok = legalFigures(g, move).some((o) => o.type === fig.type && o.feature === fig.feature);
  return ok ? null : `illegal figure ${fig.type} on feature ${fig.feature}`;
}

/** Place tile + figure and score completions, without drawing the next tile. */
export function placeAndScore(g: DevGame, move: Move, events: EngineEvent[]): void {
  const player = g.current;
  const tile = g.currentTile!;
  const key = cellKey(move.x, move.y);
  g.board.set(key, { x: move.x, y: move.y, rot: move.rot, tile, figures: [] });
  events.push({ type: "tilePlaced", player, x: move.x, y: move.y, rot: move.rot, tile });

  const fig = move.figure;
  if (fig && fig.type !== "recallAbbot") {
    const t = g.board.get(key)!;
    t.figures.push({ player, feature: fig.feature, figure: fig.type });
    const p = g.players[player]!;
    if (fig.type === "abbot") p.abbotAvailable = false;
    else p.meeples--;
    events.push({ type: "figurePlaced", player, x: move.x, y: move.y, feature: fig.feature, figure: fig.type });
  } else if (fig && fig.type === "recallAbbot") {
    const t = g.board.get(cellKey(fig.x, fig.y))!;
    const abbot = t.figures.find((f) => f.player === player && f.figure === "abbot")!;
    const analysis = analyzeBoard(g.board, g.catalog);
    const ext = analysis.extentOf(fig.x, fig.y, abbot.feature)!;
    const points = extentPoints(ext, g.board, g.ruleset, true);
    award(g, [player], ext.kind, points);
    returnFigures(g, { ...ext, figures: ext.figures.filter((f) => f.figure === "abbot" && f.player === player) });
    events.push({ type: "abbotRecalled", player, x: fig.x, y: fig.y, points });
  }

  // Completed roads / cities touching the new tile.
  const analysis = analyzeBoard(g.board, g.catalog);
  const def = g.catalog.get(tile)!;
  const done = new Set<number>();
  def.features.forEach((_, i) => {
    const ext = analysis.extentOf(move.x, move.y, i)!;
    if ((ext.kind === "road" || ext.kind === "city") && ext.complete && !done.has(ext.id)) {
      done.add(ext.id);
      if (ext.figures.length) scoreExtent(g, ext, false, events);
    }
  });
  // Cloisters / gardens around the new tile.
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++) {
      const t = g.board.get(cellKey(move.x + dx, move.y + dy));
      if (!t || !t.figures.length) continue;
      const tdef = g.catalog.get(t.tile)!;
      for (const f of [...t.figures]) {
        const kind = tdef.features[f.feature]?.kind;
        if (kind !== "cloister" && kind !== "garden") continue;
        const ext = analysis.extentOf(t.x, t.y, f.feature)!;
        if (ext.complete && !done.has(ext.id)) {
          done.add(ext.id);
          scoreExtent(g, ext, false, events);
        }
      }
    }
}

function drawTile(g: DevGame, events: EngineEvent[]) {
  g.currentTile = null;
  while (g.deck.length) {
    const tile = g.deck.pop()!;
    g.remaining[tile] = (g.remaining[tile] ?? 1) - 1;
    if (legalPlacementsOn(g.board, g.catalog, tile).length === 0) {
      events.push({ type: "tileDiscarded", tile });
      continue;
    }
    g.currentTile = tile;
    events.push({ type: "turnStarted", player: g.current, tile });
    return;
  }
  endGame(g, events);
}

function endGame(g: DevGame, events: EngineEvent[]) {
  let analysis: BoardAnalysis = analyzeBoard(g.board, g.catalog);
  for (const ext of analysis.extents) {
    if (ext.kind === "field" || !ext.figures.length) continue;
    scoreExtent(g, ext, true, events);
  }
  analysis = analyzeBoard(g.board, g.catalog);
  const fields = analysis.extents.filter((e) => e.kind === "field");
  if (g.ruleset.fieldEdition === 1) {
    for (const city of analysis.extents) {
      if (city.kind !== "city" || !city.complete) continue;
      const touching = fields.filter((f) => f.adjacentCities.includes(city.id));
      const farmers = touching.flatMap((f) => f.figures);
      const winners = majority(farmers);
      if (!winners.length) continue;
      award(g, winners, "field", 4);
      const cells = new Map<string, [number, number]>();
      for (const f of touching) for (const c of f.cells) cells.set(cellKey(c[0], c[1]), c);
      events.push({ type: "featureScored", kind: "field", cells: [...cells.values()], winners, points: 4, returned: [], final: true });
    }
  } else {
    for (const field of fields) {
      if (!field.figures.length) continue;
      const winners = majority(field.figures);
      const points = fieldPoints(field, analysis);
      award(g, winners, "field", points);
      events.push({
        type: "featureScored",
        kind: "field",
        cells: field.cells.map(([x, y]) => [x, y] as [number, number]),
        winners,
        points,
        returned: field.figures.map((f) => ({ ...f })),
        final: true,
      });
      returnFigures(g, field);
    }
  }
  g.status = "ended";
  g.currentTile = null;
  events.push({
    type: "gameEnded",
    scores: g.players.map((p) => p.score),
    breakdown: g.players.map((p) => ({ ...p.breakdown })),
  });
}

export function applyMove(g: DevGame, move: Move): { ok: true; events: EngineEvent[] } | { ok: false; error: string } {
  if (g.status !== "playing" || !g.currentTile) return { ok: false, error: "game is not in progress" };
  if (!legalPlacements(g).some((p) => p.x === move.x && p.y === move.y && p.rot === move.rot))
    return { ok: false, error: `illegal placement (${move.x},${move.y}) rot ${move.rot}` };
  const err = validateFigure(g, move);
  if (err) return { ok: false, error: err };
  const events: EngineEvent[] = [];
  placeAndScore(g, move, events);
  g.ply++;
  g.current = (g.current + 1) % g.players.length;
  drawTile(g, events);
  return { ok: true, events };
}

export type { BoardTile };
