// Pure reducer: GameView + EngineEvent -> GameView. Lets online clients and the
// replay viewer advance the public view without running the engine.

import type { EngineEvent, FeatureKind, FigureRef, GameView } from "@carcassonne/protocol";

import type { TileCatalog } from "./tiles";

function cloneView(v: GameView): GameView {
  return {
    ...v,
    ruleset: { ...v.ruleset },
    players: v.players.map((p) => ({ ...p, breakdown: { ...p.breakdown } })),
    board: v.board.map((t) => ({ ...t, figures: t.figures.map((f) => ({ ...f })) })),
    remaining: { ...v.remaining },
  };
}

function bucket(kind: FeatureKind): keyof GameView["players"][number]["breakdown"] {
  return kind === "river" ? "road" : kind;
}

function removeFigure(v: GameView, f: FigureRef) {
  const t = v.board.find((b) => b.x === f.x && b.y === f.y);
  if (t) {
    const i = t.figures.findIndex((g) => g.player === f.player && g.feature === f.feature && g.figure === f.figure);
    if (i >= 0) t.figures.splice(i, 1);
  }
  const p = v.players[f.player];
  if (!p) return;
  if (f.figure === "abbot") p.abbotAvailable = true;
  else p.meeples++;
}

function decRemaining(v: GameView, tile: string) {
  const n = (v.remaining[tile] ?? 0) - 1;
  if (n > 0) v.remaining[tile] = n;
  else delete v.remaining[tile];
}

/** Apply one event in place to a (cloned) view. */
function step(v: GameView, e: EngineEvent, catalog?: TileCatalog) {
  switch (e.type) {
    case "turnStarted":
      v.currentPlayer = e.player;
      v.currentTile = e.tile;
      decRemaining(v, e.tile);
      break;
    case "tileDiscarded":
      decRemaining(v, e.tile);
      break;
    case "tilePlaced":
      v.board.push({ x: e.x, y: e.y, rot: e.rot, tile: e.tile, figures: [] });
      v.currentTile = null;
      v.ply++;
      break;
    case "figurePlaced": {
      const t = v.board.find((b) => b.x === e.x && b.y === e.y);
      t?.figures.push({ player: e.player, feature: e.feature, figure: e.figure });
      const p = v.players[e.player];
      if (p) {
        if (e.figure === "abbot") p.abbotAvailable = false;
        else p.meeples--;
      }
      break;
    }
    case "featureScored":
      for (const w of e.winners) {
        const p = v.players[w];
        if (!p) continue;
        p.score += e.points;
        p.breakdown[bucket(e.kind)] += e.points;
      }
      for (const f of e.returned) removeFigure(v, f);
      break;
    case "abbotRecalled": {
      const t = v.board.find((b) => b.x === e.x && b.y === e.y);
      const abbot = t?.figures.find((f) => f.player === e.player && f.figure === "abbot");
      let kind: FeatureKind = "cloister";
      if (t && abbot && catalog) kind = catalog.get(t.tile)?.features[abbot.feature]?.kind ?? "cloister";
      const p = v.players[e.player];
      if (p) {
        p.score += e.points;
        p.breakdown[bucket(kind)] += e.points;
      }
      if (abbot) removeFigure(v, { player: e.player, x: e.x, y: e.y, feature: abbot.feature, figure: "abbot" });
      break;
    }
    case "gameEnded":
      v.status = "ended";
      v.currentTile = null;
      e.scores.forEach((s, i) => {
        const p = v.players[i];
        if (p) p.score = s;
      });
      e.breakdown.forEach((b, i) => {
        const p = v.players[i];
        if (p) p.breakdown = { ...b };
      });
      break;
  }
}

export function applyEvents(view: GameView, events: readonly EngineEvent[], catalog?: TileCatalog): GameView {
  const v = cloneView(view);
  for (const e of events) step(v, e, catalog);
  return v;
}

export function applyEvent(view: GameView, event: EngineEvent, catalog?: TileCatalog): GameView {
  return applyEvents(view, [event], catalog);
}
