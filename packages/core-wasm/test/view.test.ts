import { describe, expect, test } from "bun:test";
import { DEFAULT_RULESET, type Move } from "@carcassonne/protocol";

import { loadCoreKit } from "../src/index";

const kit = await loadCoreKit();

describe("CoreKit", () => {
  test("catalog lists base, garden and river tiles", () => {
    const tiles = kit.tiles();
    const ids = tiles.map((t) => t.id);
    for (const id of ["A", "D", "X", "Eg", "Vg", "R1", "R12"]) expect(ids).toContain(id);
    expect(tiles.filter((t) => t.set === "base").reduce((n, t) => n + t.count, 0)).toBe(72);
    expect(tiles.find((t) => t.id === "D")!.special).toBe("start");
    expect(tiles.find((t) => t.id === "Eg")!.features.some((f) => f.kind === "garden")).toBe(true);
  });

  test("a game rebuilt from the public view agrees with the real one", () => {
    const g = kit.core.createGame(DEFAULT_RULESET, 1234n, 3);
    let checked = 0;
    for (let ply = 0; ply < 40; ply++) {
      const view = g.view();
      if (view.status !== "playing") break;
      const v = kit.fromView(view);
      try {
        expect(v.view()).toEqual(view);
        const legal = g.legalPlacements();
        expect(v.legalPlacements()).toEqual(legal);
        const p = legal[(ply * 7) % legal.length]!;
        const figs = g.legalFigures(p);
        expect(v.legalFigures(p)).toEqual(figs);
        const f = figs[ply % Math.max(1, figs.length)];
        const move: Move = { ...p, figure: f && ply % 3 === 0 ? { type: f.type, feature: f.feature } : null };
        expect(g.apply(move).ok).toBe(true);
        checked++;
      } finally {
        v.free();
      }
    }
    expect(checked).toBeGreaterThan(30);
    g.free();
  });

  test("rejects a malformed view", () => {
    const view = kit.core.createGame(DEFAULT_RULESET, 1n, 2).view();
    expect(() => kit.fromView({ ...view, board: [] })).toThrow();
  });
});
