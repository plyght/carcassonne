import { describe, expect, test } from "bun:test";

import { replay } from "@carcassonne/api/game/engine";
import { DEFAULT_RULESET, type Move } from "@carcassonne/protocol";

import { engineLoader } from "../src/engine";

describe("real core.wasm engine", () => {
  test("plays a full seeded game to the end and replays deterministically", async () => {
    const engine = await engineLoader({ kind: "wasm", version: "test" })();
    const game = engine.createGame(DEFAULT_RULESET, 42n, 3);
    const moves: Move[] = [];
    let ended = false;
    for (let ply = 0; ply < 200 && !ended; ply++) {
      const move = game.aiChoose("easy", 50, BigInt(ply * 7919 + 13));
      const r = game.apply(move);
      expect(r.ok).toBe(true);
      if (r.ok) ended = r.events.some((e) => e.type === "gameEnded");
      moves.push(move);
    }
    expect(ended).toBe(true);
    const final = game.view();
    expect(final.status).toBe("ended");

    const again = replay(engine, { ruleset: DEFAULT_RULESET, seed: 42n, players: 3, moves });
    expect(again.view()).toEqual(final);
    game.free();
    again.free();
  });
});
