import { describe, expect, test } from "bun:test";

import type { EngineEvent } from "@carcassonne/protocol";

import type { PlayerMeta } from "./client";
import { catalogFromKit, loadEngine } from "./engine";
import { describeTile, explainScore, narrateBatch, possessive } from "./narrate";

const catalog = catalogFromKit((await loadEngine()).kit);
const players: PlayerMeta[] = [
  { name: "You", color: "blue", kind: "human" },
  { name: "Brother Odo", color: "red", kind: "bot", tier: "medium" },
];
type Scored = Extract<EngineEvent, { type: "featureScored" }>;
const cells = (n: number) => Array.from({ length: n }, (_, i) => [i, 0] as [number, number]);
const scored = (p: Partial<Scored>): Scored => ({ type: "featureScored", kind: "city", cells: cells(3), winners: [0], points: 8, returned: [], final: false, ...p });

describe("narration", () => {
  test("tiles are named by their main feature", () => {
    expect(describeTile(catalog.get("M"))).toBe("a city tile");
    expect(describeTile(catalog.get("D"))).toBe("a city tile with a road");
    expect(describeTile(catalog.get("U"))).toBe("a road tile");
    expect(describeTile(catalog.get("A"))).toBe("a cloister tile with a road");
    expect(possessive("Brother Odo")).toBe("Brother Odo’s");
    expect(possessive("You")).toBe("Your");
  });

  test("a bot move says what was placed and claimed", () => {
    const lines = narrateBatch(
      [
        { type: "tilePlaced", player: 1, x: 1, y: 0, rot: 0, tile: "M" },
        { type: "figurePlaced", player: 1, x: 1, y: 0, feature: 0, figure: "meeple" },
      ],
      players,
      catalog,
    );
    expect(lines.map((l) => l.text)).toEqual(["Brother Odo placed a city tile and claimed the city with a knight."]);
  });

  test("scores explain what, why and for whom", () => {
    expect(explainScore(scored({ returned: [{ player: 0, x: 0, y: 0, feature: 0, figure: "meeple" }] }), players)).toBe(
      "Your city is complete: 3 tiles + 1 shield, 2 points each = 8 points. Your knight comes back.",
    );
    expect(explainScore(scored({ kind: "road", cells: cells(4), points: 4, winners: [1] }), players)).toBe("Brother Odo’s road is complete: 4 tiles = 4 points.");
    expect(explainScore(scored({ kind: "cloister", points: 9 }), players)).toBe("Your cloister is surrounded by 8 tiles: 9 points.");
    expect(explainScore(scored({ kind: "cloister", points: 6, final: true }), players)).toBe("Your cloister has 5 neighbours at the end: 1 + 5 = 6 points.");
    expect(explainScore(scored({ kind: "field", points: 6, final: true }), players)).toBe("Your farmers’ field touches 2 finished cities: 2 × 3 = 6 points.");
    expect(explainScore(scored({ winners: [0, 1], points: 6 }), players)).toBe("The city is complete: 3 tiles, 2 points each = 6 points. You and Brother Odo tied for the most knights, so each scores it.");
    expect(explainScore(scored({ winners: [] }), players)).toBeNull();
  });
});
