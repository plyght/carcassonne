import { describe, expect, test } from "bun:test";

import { fromGlicko1, INITIAL, placements, rate, rateFfa, toGlicko1 } from "../src/ratings/glicko2";

describe("Glicko-2", () => {
  test("matches Glickman's worked example", () => {
    const p = fromGlicko1(1500, 200, 0.06);
    const r = rate(p, [
      { opponent: fromGlicko1(1400, 30), score: 1 },
      { opponent: fromGlicko1(1550, 100), score: 0 },
      { opponent: fromGlicko1(1700, 300), score: 0 },
    ]);
    const g1 = toGlicko1(r);
    expect(g1.rating).toBeCloseTo(1464.06, 1);
    expect(g1.rd).toBeCloseTo(151.52, 1);
    expect(g1.sigma).toBeCloseTo(0.05999, 4);
  });

  test("no games only inflates RD", () => {
    const r = rate(INITIAL, []);
    expect(r.mu).toBe(0);
    expect(r.phi).toBeGreaterThan(INITIAL.phi);
  });

  test("FFA pairwise: winner up, loser down, middle ~neutral among equals", () => {
    const after = rateFfa([INITIAL, INITIAL, INITIAL], [30, 20, 10]);
    expect(after[0]!.mu).toBeGreaterThan(0);
    expect(after[2]!.mu).toBeLessThan(0);
    expect(Math.abs(after[1]!.mu)).toBeLessThan(1e-9);
    // Zero-sum among equal-rated players.
    expect(after[0]!.mu + after[2]!.mu).toBeCloseTo(0, 9);
    for (const r of after) expect(r.phi).toBeLessThan(INITIAL.phi);
  });

  test("ties are draws", () => {
    const after = rateFfa([INITIAL, INITIAL, INITIAL, INITIAL], [10, 10, 10, 10]);
    for (const r of after) expect(Math.abs(r.mu)).toBeLessThan(1e-9);
  });

  test("result does not depend on seat order", () => {
    const a = fromGlicko1(1700, 80);
    const b = fromGlicko1(1500, 120);
    const c = fromGlicko1(1450, 300);
    const x = rateFfa([a, b, c], [5, 9, 7]);
    const y = rateFfa([c, a, b], [7, 5, 9]);
    expect(x[0]!.mu).toBeCloseTo(y[1]!.mu, 12);
    expect(x[1]!.mu).toBeCloseTo(y[2]!.mu, 12);
    expect(x[2]!.mu).toBeCloseTo(y[0]!.mu, 12);
  });

  test("upset moves ratings more than an expected result", () => {
    const strong = fromGlicko1(1800, 60);
    const weak = fromGlicko1(1400, 60);
    const upset = rateFfa([strong, weak], [1, 2]);
    const expected = rateFfa([strong, weak], [2, 1]);
    expect(strong.mu - upset[0]!.mu).toBeGreaterThan(expected[0]!.mu - strong.mu);
  });

  test("placements share ties", () => {
    expect(placements([10, 10, 5])).toEqual([1, 1, 3]);
    expect(placements([3, 9, 6, 9])).toEqual([4, 1, 3, 1]);
  });
});
