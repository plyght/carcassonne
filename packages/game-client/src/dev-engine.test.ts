import { describe, expect, test } from "bun:test";

import { DEFAULT_RULESET, type GameView, type Ruleset } from "@carcassonne/protocol";

import { applyEvents } from "./apply-events";
import { analyzeBoard, boardFromTiles, extentPoints } from "./board";
import { DevEngine } from "./dev-engine";
import { baseCatalog, BASE_TILES } from "./dev-engine/tiles-base";
import { seedFromString } from "./engine-port";
import { edgeKind, opposingPort, rotatePorts } from "./tiles";

const RULES: Ruleset = { ...DEFAULT_RULESET, river: false };

const norm = (v: GameView) => ({
  currentPlayerIfPlaying: v.status === "playing" ? v.currentPlayer : null,
  ...v,
  currentPlayer: 0,
  board: [...v.board]
    .map((t) => ({ ...t, figures: [...t.figures].sort((a, b) => a.feature - b.feature) }))
    .sort((a, b) => a.y - b.y || a.x - b.x),
});

describe("tile schema", () => {
  test("port maths matches tile.zig", () => {
    expect(rotatePorts(0b1, 1)).toBe(0b1000);
    expect(rotatePorts(1 << 9, 1)).toBe(0b1);
    expect(opposingPort(0)).toBe(8);
    expect(opposingPort(1)).toBe(7);
    expect(opposingPort(3)).toBe(11);
  });

  test("base set has 72 tiles over 24 types, every port owned exactly once", () => {
    expect(BASE_TILES.length).toBe(24);
    expect(BASE_TILES.reduce((n, t) => n + t.count, 0)).toBe(72);
    for (const t of BASE_TILES) {
      let seen = 0;
      for (const f of t.features) {
        expect(seen & f.ports).toBe(0);
        seen |= f.ports;
      }
      expect(seen).toBe(0xfff);
    }
  });

  test("edge kinds rotate clockwise", () => {
    const d = baseCatalog.get("D")!;
    expect(edgeKind(d, 0, 0)).toBe("city");
    expect(edgeKind(d, 1, 1)).toBe("city");
    expect(edgeKind(d, 2, 2)).toBe("city");
    expect(edgeKind(d, 0, 1)).toBe("road");
  });
});

describe("scoring", () => {
  test("two-tile city: 4 points (3rd ed), 2 points (1st ed)", () => {
    // E rotated 2 has its city facing south, onto D's northern city.
    const board = boardFromTiles([
      { x: 0, y: 0, rot: 0, tile: "D", figures: [{ player: 0, feature: 0, figure: "meeple" }] },
      { x: 0, y: -1, rot: 2, tile: "E", figures: [] },
    ]);
    const a = analyzeBoard(board, baseCatalog);
    const city = a.extentOf(0, 0, 0)!;
    expect(city.kind).toBe("city");
    expect(city.complete).toBe(true);
    expect(city.cells.length).toBe(2);
    expect(city.figures.length).toBe(1);
    expect(extentPoints(city, board, { fieldEdition: 3 }, false)).toBe(4);
    expect(extentPoints(city, board, { fieldEdition: 1 }, false)).toBe(2);
    // The field above D's road touches the city.
    const field = a.extentOf(0, 0, 2)!;
    expect(field.adjacentCities).toContain(city.id);
  });
});

describe("dev engine", () => {
  function playOut(seed: string, players: number, rules: Ruleset = RULES) {
    const eng = new DevEngine();
    const h = eng.createGame(rules, seedFromString(seed), players);
    let view = eng.view(h);
    const moves = [];
    let guard = 0;
    while (view.status === "playing" && guard++ < 200) {
      const move = eng.aiChoose(h, "medium", 100, BigInt(guard));
      const r = eng.apply(h, move);
      expect(r.ok).toBe(true);
      if (!r.ok) break;
      moves.push(move);
      const reduced = applyEvents(view, r.events, baseCatalog);
      view = eng.view(h);
      expect(norm(reduced)).toEqual(norm(view));
      // Meeple conservation.
      view.players.forEach((p, i) => {
        const onBoard = view.board.flatMap((t) => t.figures).filter((f) => f.player === i && f.figure === "meeple").length;
        expect(p.meeples + onBoard).toBe(7);
      });
    }
    return { eng, h, view, moves };
  }

  test("AI vs AI plays to the end; reducer tracks the engine view", () => {
    const { view } = playOut("unit-test-1", 3);
    expect(view.status).toBe("ended");
    expect(view.currentTile).toBeNull();
    expect(Object.keys(view.remaining).length).toBe(0);
    expect(view.board.length).toBeGreaterThan(60);
    const total = view.players.reduce((n, p) => n + p.score, 0);
    expect(total).toBeGreaterThan(50);
    for (const p of view.players) {
      const b = p.breakdown;
      expect(b.road + b.city + b.cloister + b.garden + b.field).toBe(p.score);
    }
  }, 60_000);

  test("same seed + moves reproduce the same game", () => {
    const a = playOut("determinism", 2);
    const eng = new DevEngine();
    const h = eng.createGame(RULES, seedFromString("determinism"), 2);
    for (const m of a.moves) expect(eng.apply(h, m).ok).toBe(true);
    expect(norm(eng.view(h))).toEqual(norm(a.view));
  }, 60_000);

  test("1st edition field scoring also completes", () => {
    const { view } = playOut("first-ed", 2, { ...RULES, fieldEdition: 1 });
    expect(view.status).toBe("ended");
  }, 60_000);

  test("rejects illegal moves", () => {
    const eng = new DevEngine();
    const h = eng.createGame(RULES, 42n, 2);
    const r = eng.apply(h, { x: 5, y: 5, rot: 0, figure: null });
    expect(r.ok).toBe(false);
    const legal = eng.legalPlacements(h);
    expect(legal.length).toBeGreaterThan(0);
    const p = legal[0]!;
    const bad = eng.apply(h, { ...p, figure: { type: "meeple", feature: 99 } });
    expect(bad.ok).toBe(false);
  });
});
