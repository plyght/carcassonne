import { describe, expect, test } from "bun:test";

import type { EngineEvent } from "@carcassonne/protocol";

import type { PlayerMeta, Timers } from "./client";
import { catalogFromKit, loadEngine } from "./engine";
import { TUTORIAL_CHAPTERS, TutorialClient } from "./tutorial";

const port = await loadEngine();
const kit = port.kit;
const catalog = catalogFromKit(kit);
const players: PlayerMeta[] = [
  { name: "You", color: "blue", kind: "human" },
  { name: "Brother Odo", color: "red", kind: "bot", tier: "easy" },
];

/** Timers that run callbacks on demand. */
function manualTimers() {
  const queue: (() => void)[] = [];
  const timers: Timers = { setTimeout: (fn) => queue.push(fn), clearTimeout: () => {}, now: () => 0 };
  return { timers, flush: () => queue.splice(0).forEach((f) => f()) };
}

/** Play the step the way the lesson wants: first allowed placement, first allowed figure. */
async function playStep(c: TutorialClient, flush: () => void): Promise<EngineEvent[]> {
  const legal = c.getState().legalPlacements;
  expect(legal.length).toBeGreaterThan(0);
  const p = legal[0]!;
  const figs = await c.legalFigures(p);
  const step = c.step!;
  if (step.figure) expect(figs.length).toBeGreaterThan(0);
  else expect(figs).toEqual([]);
  await c.submit({ ...p, figure: figs[0] ? { type: figs[0].type, feature: figs[0].feature } : null });
  const events = c.progress.lastEvents;
  flush();
  return events;
}

const scored = (events: EngineEvent[]) => events.filter((e): e is Extract<EngineEvent, { type: "featureScored" }> => e.type === "featureScored" && e.winners.length > 0);

describe("tutorial lessons on the real engine", () => {
  test("every lesson plays through and scores what it teaches", async () => {
    const { timers, flush } = manualTimers();
    const c = new TutorialClient(kit, players, { catalog, timers });
    c.start();
    const byStep: Record<string, EngineEvent[]> = {};
    for (let ch = 0; ch < TUTORIAL_CHAPTERS.length; ch++) {
      expect(c.progress.chapter).toBe(ch);
      while (!c.progress.chapterDone) {
        const id = c.step!.id;
        byStep[id] = await playStep(c, flush);
      }
      c.next();
    }
    // place / rotate: no scoring
    expect(scored(byStep.place!)).toEqual([]);
    expect(scored(byStep.rotate!)).toEqual([]);
    // road: 4 tiles, the thief comes back
    const road = scored(byStep["road-finish"]!);
    expect(road.map((e) => [e.kind, e.points, e.winners])).toEqual([["road", 4, [0]]]);
    expect(road[0]!.returned.map((f) => f.player)).toEqual([0]);
    // city: 3 tiles + 1 shield = 8 (3rd edition)
    expect(scored(byStep.city!).map((e) => [e.kind, e.points, e.cells.length])).toEqual([["city", 8, 3]]);
    // cloister: surrounded = 9
    expect(scored(byStep["cloister-finish"]!).map((e) => [e.kind, e.points])).toEqual([["cloister", 9]]);
    // farmer: the game ends, the field scores 3 for the finished city
    const end = byStep.farmer!;
    expect(end.some((e) => e.type === "gameEnded")).toBe(true);
    expect(scored(end).map((e) => [e.kind, e.points, e.final])).toEqual([["field", 3, true]]);
    expect(c.getState().view!.players[0]!.score).toBe(4 + 8 + 9 + 3);
    c.dispose();
  });

  test("the rotation lesson starts with the tile turned the wrong way", () => {
    const { timers } = manualTimers();
    const c = new TutorialClient(kit, players, { catalog, timers });
    c.start(1);
    const step = c.step!;
    expect(step.snap).toBe(false);
    const rots = c.getState().legalPlacements.map((p) => p.rot);
    expect(rots.length).toBeGreaterThan(0);
    expect(rots).not.toContain(step.startRot);
    c.dispose();
  });

  test("refuses moves the lesson does not teach", async () => {
    const { timers } = manualTimers();
    const c = new TutorialClient(kit, players, { catalog, timers });
    c.start(2);
    const p = c.getState().legalPlacements[0]!;
    await c.submit({ ...p, figure: null });
    expect(c.progress.refusal).toMatch(/road/);
    expect(c.getState().view!.ply).toBe(0);
    c.dispose();
  });
});
