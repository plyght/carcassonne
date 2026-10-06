import { describe, expect, test } from "bun:test";
import { DEFAULT_RULESET, type Move } from "@carcassonne/protocol";
import { AI_TIERS, loadCore, type Core, type EngineGame } from "../src/index";

const core: Core = await loadCore();

/** Play `plies` moves chosen by `pick`; returns the moves played. */
function play(game: EngineGame, plies: number, pick: (ply: number) => Move | null): Move[] {
  const moves: Move[] = [];
  for (let ply = 0; ply < plies; ply++) {
    const move = pick(ply);
    if (move === null) break;
    const r = game.apply(move);
    expect(r).toMatchObject({ ok: true });
    moves.push(move);
  }
  return moves;
}

describe("ai_choose", () => {
  test("bots finish a full game with only legal moves (medium vs easy)", () => {
    const game = core.createGame(DEFAULT_RULESET, 2024n, 2);
    const moves = play(game, 200, (ply) => game.aiChoose(ply % 2 === 0 ? "medium" : "easy", 0, ply));
    const view = game.view();
    expect(view.status).toBe("ended");
    expect(moves.length).toBeGreaterThan(30);
    // Once the game is over there is nothing to choose.
    expect(game.aiChoose("medium", 0, 1)).toBeNull();
    game.free();
  });

  test("every tier returns a legal move, including in 3-4 player games without the river", () => {
    for (const [players, ruleset] of [
      [3, { ...DEFAULT_RULESET, river: false }],
      [4, { ...DEFAULT_RULESET, abbot: false, fieldEdition: 2 }],
    ] as const) {
      const game = core.createGame(ruleset, 77n, players);
      play(game, 12, (ply) => game.aiChoose("easy", 0, ply));
      for (const tier of AI_TIERS) {
        const move = game.aiChoose(tier, 20, 5);
        expect(move).not.toBeNull();
        const legal = game.legalPlacements().some((p) => p.x === move!.x && p.y === move!.y && p.rot === move!.rot);
        expect(legal).toBe(true);
        if (move!.figure && move!.figure.type !== "recallAbbot") {
          const figures = game.legalFigures(move!);
          expect(figures).toContainEqual({ type: move!.figure.type, feature: move!.figure.feature });
        }
      }
      game.free();
    }
  });

  test("deterministic for the same state, tier, budget and seed", () => {
    const a = core.createGame(DEFAULT_RULESET, 99n, 2);
    const b = core.createGame(DEFAULT_RULESET, 99n, 2);
    const moves = play(a, 20, (ply) => a.aiChoose("medium", 0, ply));
    for (const m of moves) expect(b.apply(m).ok).toBe(true);
    expect(a.hash()).toBe(b.hash());
    for (const tier of AI_TIERS) {
      expect(a.aiChoose(tier, 30, 0xdeadbeefcafen)).toEqual(b.aiChoose(tier, 30, 0xdeadbeefcafen));
    }
    // Numeric tiers match the names.
    expect(a.aiChoose(2, 30, 1n)).toEqual(a.aiChoose("hard", 30, 1n));
    a.free();
    b.free();
  });

  test("rejects unknown tiers on the TS side", () => {
    const game = core.createGame(DEFAULT_RULESET, 1n, 2);
    expect(() => game.aiChoose(7 as never, 0, 1)).toThrow();
    game.free();
  });
});
