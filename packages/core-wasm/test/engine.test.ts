import { describe, expect, test } from "bun:test";
import { DEFAULT_RULESET, type EngineEvent, type GameView, type Move, type Ruleset } from "@carcassonne/protocol";
import { loadCore, type Core, type EngineGame } from "../src/index";

const core: Core = await loadCore();

// Mirrors FIRST_CHOICE_* in packages/core/src/engine/soak_test.zig.
const FIRST_CHOICE_SEED = 0x5eedc0ffeen;
const FIRST_CHOICE_PLAYERS = 3;
const FIRST_CHOICE_HASH = 0xf33b6098a57029b3n;

/** Small deterministic PRNG for choosing moves in tests. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isRot = (v: unknown) => v === 0 || v === 1 || v === 2 || v === 3;
const FEATURE_KINDS = new Set(["road", "city", "field", "cloister", "garden", "river"]);
const FIGURES = new Set(["meeple", "abbot"]);

function checkBreakdown(b: unknown) {
  expect(Object.keys(b as object).sort()).toEqual(["city", "cloister", "field", "garden", "road"]);
  for (const v of Object.values(b as object)) expect(isInt(v)).toBe(true);
}

function checkView(v: GameView, players: number, ruleset: Ruleset) {
  expect(Object.keys(v).sort()).toEqual(
    ["board", "currentPlayer", "currentTile", "players", "ply", "remaining", "ruleset", "status"].sort(),
  );
  expect(isInt(v.ply)).toBe(true);
  expect(["playing", "ended"]).toContain(v.status);
  expect(v.ruleset).toEqual(ruleset);
  expect(v.players).toHaveLength(players);
  for (const p of v.players) {
    expect(isInt(p.score)).toBe(true);
    expect(p.meeples).toBeGreaterThanOrEqual(0);
    expect(p.meeples).toBeLessThanOrEqual(7);
    expect(typeof p.abbotAvailable).toBe("boolean");
    checkBreakdown(p.breakdown);
  }
  expect(v.currentPlayer).toBeLessThan(players);
  if (v.status === "playing") expect(typeof v.currentTile).toBe("string");
  else expect(v.currentTile).toBeNull();
  for (const t of v.board) {
    expect(isInt(t.x) && isInt(t.y) && isRot(t.rot)).toBe(true);
    expect(typeof t.tile).toBe("string");
    for (const f of t.figures) {
      expect(f.player).toBeLessThan(players);
      expect(isInt(f.feature)).toBe(true);
      expect(FIGURES.has(f.figure)).toBe(true);
    }
  }
  for (const [id, n] of Object.entries(v.remaining)) {
    expect(id).toMatch(/^([A-X]g?|R\d+)$/);
    expect(isInt(n)).toBe(true);
  }
}

function checkEvent(e: EngineEvent, players: number) {
  const keys = Object.keys(e).sort();
  switch (e.type) {
    case "turnStarted":
      expect(keys).toEqual(["player", "tile", "type"]);
      expect(e.player).toBeLessThan(players);
      break;
    case "tileDiscarded":
      expect(keys).toEqual(["tile", "type"]);
      break;
    case "tilePlaced":
      expect(keys).toEqual(["player", "rot", "tile", "type", "x", "y"]);
      expect(isRot(e.rot)).toBe(true);
      break;
    case "figurePlaced":
      expect(keys).toEqual(["feature", "figure", "player", "type", "x", "y"]);
      expect(FIGURES.has(e.figure)).toBe(true);
      break;
    case "featureScored":
      expect(keys).toEqual(["cells", "final", "kind", "points", "returned", "type", "winners"]);
      expect(FEATURE_KINDS.has(e.kind)).toBe(true);
      for (const c of e.cells) expect(c).toHaveLength(2);
      for (const w of e.winners) expect(w).toBeLessThan(players);
      for (const r of e.returned) expect(Object.keys(r).sort()).toEqual(["feature", "figure", "player", "x", "y"]);
      expect(typeof e.final).toBe("boolean");
      break;
    case "abbotRecalled":
      expect(keys).toEqual(["player", "points", "type", "x", "y"]);
      break;
    case "gameEnded":
      expect(keys).toEqual(["breakdown", "scores", "type"]);
      expect(e.scores).toHaveLength(players);
      e.breakdown.forEach(checkBreakdown);
      break;
    default:
      throw new Error(`unknown event ${JSON.stringify(e)}`);
  }
}

function randomMove(g: EngineGame, rnd: () => number): Move {
  const ps = g.legalPlacements();
  expect(ps.length).toBeGreaterThan(0);
  const p = ps[Math.floor(rnd() * ps.length)]!;
  const opts = g.legalFigures(p);
  const opt = rnd() < 0.6 ? opts[Math.floor(rnd() * opts.length)] : undefined;
  return { ...p, figure: opt ? { type: opt.type, feature: opt.feature } : null };
}

function playRandom(seed: number, ruleset: Ruleset, players: number) {
  const g = core.createGame(ruleset, seed, players);
  const rnd = mulberry32(seed);
  const moves: Move[] = [];
  let events: EngineEvent[] = [];
  try {
    checkView(g.view(), players, ruleset);
    while (g.view().status === "playing") {
      const m = randomMove(g, rnd);
      const res = g.apply(m);
      if (!res.ok) throw new Error(res.error);
      moves.push(m);
      events = res.events;
      for (const e of events) checkEvent(e, players);
      expect(events[0]!.type).toBe("tilePlaced");
    }
    const v = g.view();
    checkView(v, players, ruleset);
    const last = events[events.length - 1]!;
    expect(last.type).toBe("gameEnded");
    if (last.type === "gameEnded") expect(last.scores).toEqual(v.players.map((p) => p.score));
    for (const p of v.players) expect(p.meeples).toBe(7);
    return { moves, hash: g.hash() };
  } finally {
    g.free();
  }
}

describe("core-wasm", () => {
  test("plays full seeded games with random legal moves", () => {
    const rulesets: Ruleset[] = [
      DEFAULT_RULESET,
      { fieldEdition: 1, river: false, abbot: false, handSize: 1 },
      { fieldEdition: 2, river: true, abbot: true, handSize: 1 },
    ];
    for (let i = 0; i < 6; i++) playRandom(1000 + i, rulesets[i % 3]!, 2 + (i % 4));
  });

  test("same seed and moves give the same hash", () => {
    const a = playRandom(42, DEFAULT_RULESET, 4);
    const g = core.createGame(DEFAULT_RULESET, 42, 4);
    for (const m of a.moves) expect(g.apply(m).ok).toBe(true);
    expect(g.hash()).toBe(a.hash);
    g.free();
  });

  test("matches the native first-choice hash", () => {
    const g = core.createGame(DEFAULT_RULESET, FIRST_CHOICE_SEED, FIRST_CHOICE_PLAYERS);
    while (g.view().status === "playing") {
      const p = g.legalPlacements()[0]!;
      const o = g.legalFigures(p)[0];
      const res = g.apply({ ...p, figure: o ? { type: o.type, feature: o.feature } : null });
      expect(res.ok).toBe(true);
    }
    expect(g.hash()).toBe(FIRST_CHOICE_HASH);
    g.free();
  });

  test("rejects illegal moves without changing state", () => {
    const g = core.createGame(DEFAULT_RULESET, 7, 2);
    const before = g.hash();
    const res = g.apply({ x: 50, y: 50, rot: 0, figure: null });
    expect(res).toEqual({ ok: false, error: "illegal tile placement" });
    expect(g.hash()).toBe(before);
    const bad = g.apply({ x: 0, y: 1, rot: 0, figure: { type: "meeple", feature: 7 } });
    expect(bad.ok).toBe(false);
    g.free();
  });

  test("snapshot and restore keep the full state", () => {
    const g = core.createGame(DEFAULT_RULESET, 99, 3);
    const rnd = mulberry32(5);
    for (let i = 0; i < 20; i++) expect(g.apply(randomMove(g, rnd)).ok).toBe(true);
    const snap = g.snapshot();
    expect(snap.v).toBe(1);
    const r = core.restore(snap);
    expect(r.hash()).toBe(g.hash());
    expect(r.view()).toEqual(g.view());
    // Both continue identically, including the hidden deck order.
    const m = randomMove(g, mulberry32(9));
    expect(r.apply(m)).toEqual(g.apply(m));
    expect(r.hash()).toBe(g.hash());
    expect(() => core.restore({ ...snap, hash: "0000000000000000" })).toThrow();
    g.free();
    r.free();
  });

  test("rejects bad setup", () => {
    expect(() => core.createGame(DEFAULT_RULESET, 1, 1)).toThrow();
    expect(() => core.createGame(DEFAULT_RULESET, 1, 6)).toThrow();
    expect(() => core.createGame({ ...DEFAULT_RULESET, handSize: 2 }, 1, 2)).toThrow();
  });
});
