import { describe, expect, test } from "bun:test";

import { DEFAULT_RULESET, type GameView, type Ruleset } from "@carcassonne/protocol";

import { applyEvents } from "./apply-events";
import { analyzeBoard, boardFromTiles, extentPoints, legalPlacementsOn } from "./board";
import { catalogFromKit, loadEngine, randomLegalMove, viewRules } from "./engine";
import { seedFromString } from "./engine-port";
import { edgeKind, opposingPort, rotatePorts } from "./tiles";

const port = await loadEngine();
const catalog = catalogFromKit(port.kit);
const NO_RIVER: Ruleset = { ...DEFAULT_RULESET, river: false };

const norm = (v: GameView) => ({
  ...v,
  board: [...v.board].map((t) => ({ ...t, figures: [...t.figures].sort((a, b) => a.player - b.player || a.feature - b.feature) })),
});

describe("tile catalog (from core.wasm)", () => {
  test("port maths matches tile.zig", () => {
    expect(rotatePorts(0b1, 1)).toBe(0b1000);
    expect(rotatePorts(1 << 9, 1)).toBe(0b1);
    expect(opposingPort(0)).toBe(8);
    expect(opposingPort(1)).toBe(7);
    expect(opposingPort(3)).toBe(11);
  });

  test("base 72 tiles, garden variants and the river; every port owned once", () => {
    const all = catalog.all();
    expect(all.filter((t) => t.set === "base").reduce((n, t) => n + t.count, 0)).toBe(72);
    expect(all.filter((t) => t.set === "river").length).toBe(12);
    for (const id of ["Eg", "Hg", "Ig", "Mg", "Ng", "Rg", "Ug", "Vg"]) expect(catalog.get(id)).toBeDefined();
    for (const t of all) {
      let seen = 0;
      for (const f of t.features) {
        expect(seen & f.ports).toBe(0);
        seen |= f.ports;
      }
      expect(seen).toBe(0xfff);
    }
  });

  test("edge kinds rotate clockwise", () => {
    const d = catalog.get("D")!;
    expect(edgeKind(d, 0, 0)).toBe("city");
    expect(edgeKind(d, 1, 1)).toBe("city");
    expect(edgeKind(d, 2, 2)).toBe("city");
    expect(edgeKind(d, 0, 1)).toBe("road");
  });

  test("two-tile city: 4 points (3rd ed), 2 points (1st ed)", () => {
    const board = boardFromTiles([
      { x: 0, y: 0, rot: 0, tile: "D", figures: [{ player: 0, feature: 0, figure: "meeple" }] },
      { x: 0, y: -1, rot: 2, tile: "E", figures: [] },
    ]);
    const a = analyzeBoard(board, catalog);
    const d = catalog.get("D")!;
    const cityIdx = d.features.findIndex((f) => f.kind === "city");
    const city = a.extentOf(0, 0, cityIdx)!;
    expect(city.complete).toBe(true);
    expect(city.cells.length).toBe(2);
    expect(extentPoints(city, board, { fieldEdition: 3 }, false)).toBe(4);
    expect(extentPoints(city, board, { fieldEdition: 1 }, false)).toBe(2);
  });
});

describe("core engine port", () => {
  function playOut(seed: string, players: number, rules: Ruleset) {
    const h = port.createGame(rules, seedFromString(seed), players);
    let view = port.view(h);
    let guard = 0;
    while (view.status === "playing" && guard++ < 200) {
      const move = port.aiChoose(h, "easy", 10, BigInt(guard));
      const r = port.apply(h, move);
      expect(r.ok).toBe(true);
      if (!r.ok) break;
      const reduced = applyEvents(view, r.events, catalog);
      view = port.view(h);
      expect(norm(reduced)).toEqual(norm(view));
      view.players.forEach((p, i) => {
        const onBoard = view.board.flatMap((t) => t.figures).filter((f) => f.player === i && f.figure === "meeple").length;
        expect(p.meeples + onBoard).toBe(7);
      });
    }
    port.freeGame(h);
    return view;
  }

  test("bots play River + Abbot games to the end; the reducer tracks the engine", () => {
    const view = playOut("unit-test-1", 3, DEFAULT_RULESET);
    expect(view.status).toBe("ended");
    expect(view.board.some((t) => t.tile === "R12")).toBe(true);
    for (const p of view.players) {
      const b = p.breakdown;
      expect(b.road + b.city + b.cloister + b.garden + b.field).toBe(p.score);
    }
  }, 60_000);

  test("base game, 1st edition fields", () => {
    expect(playOut("first-ed", 2, { ...NO_RIVER, fieldEdition: 1, abbot: false }).status).toBe("ended");
  }, 60_000);

  test("fallback bot is deterministic per seed", () => {
    const h = port.createGame(DEFAULT_RULESET, 5n, 2);
    const g = { legalPlacements: () => port.legalPlacements(h), legalFigures: (p: { x: number; y: number; rot: 0 | 1 | 2 | 3 }) => port.legalFigures(h, p.x, p.y, p.rot) };
    expect(randomLegalMove(g, 99n)).toEqual(randomLegalMove(g, 99n));
    port.freeGame(h);
  });

  test("view rules: online legality from the public view matches the engine", () => {
    const rules = viewRules(port.kit);
    const h = port.createGame(DEFAULT_RULESET, 77n, 2);
    for (let i = 0; i < 25; i++) {
      const v = port.view(h);
      expect(rules.legalPlacements(v)).toEqual(port.legalPlacements(h));
      const p = port.legalPlacements(h)[0]!;
      expect(rules.legalFigures(v, p)).toEqual(port.legalFigures(h, p.x, p.y, p.rot));
      expect(port.apply(h, port.aiChoose(h, "easy", 1, BigInt(i))).ok).toBe(true);
    }
    // During the river phase the TS check is looser than the engine (no U-turn rule).
    const v0 = port.view(port.createGame(DEFAULT_RULESET, 1n, 2));
    expect(rules.legalPlacements(v0).length).toBeLessThanOrEqual(
      legalPlacementsOn(boardFromTiles(v0.board), catalog, v0.currentTile!).length,
    );
    port.freeGame(h);
  });

  test("rejects illegal moves", () => {
    const h = port.createGame(NO_RIVER, 42n, 2);
    expect(port.apply(h, { x: 5, y: 5, rot: 0, figure: null }).ok).toBe(false);
    const p = port.legalPlacements(h)[0]!;
    expect(port.apply(h, { ...p, figure: { type: "meeple", feature: 99 } }).ok).toBe(false);
    port.freeGame(h);
  });
});
