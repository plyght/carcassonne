import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CoreGeo, type AnimTimeline } from "@carcassonne/core-geo";
import { ManualClock, TimelinePlayer, ease } from "../src/timeline";

const tl = (clips: [string, number, number][], easing: "linear" | "step" | "easeOutBack" = "linear"): AnimTimeline => ({
  version: 1,
  style: "realistic",
  duration: Math.max(...clips.map(([, s, d]) => s + d)),
  clips: clips.map(([key, start, duration], i) => ({ key, kind: "tileDrop", start, duration, easing, event: i, target: { type: "board" } })),
});

describe("timeline playback (deterministic clock)", () => {
  test("start/end hooks fire once, in order, and progress follows the clock", () => {
    const log: string[] = [];
    const p = new TimelinePlayer({ onStart: (c) => log.push(`+${c.clip.key}`), onEnd: (c) => log.push(`-${c.clip.key}`) });
    let done = 0;
    p.enqueue(tl([["a", 0, 1], ["b", 0.5, 1]]), () => done++);
    const clock = new ManualClock();
    clock.tick(0.25);
    p.advance(clock.delta());
    expect(log).toEqual(["+a"]);
    expect(p.active()[0]!.t).toBeCloseTo(0.25);
    clock.tick(0.5);
    p.advance(clock.delta());
    expect(log).toEqual(["+a", "+b"]);
    expect(p.active().map((s) => s.clip.key)).toEqual(["a", "b"]);
    p.advance(0.5); // t = 1.25
    expect(log).toEqual(["+a", "+b", "-a"]);
    expect(done).toBe(0);
    p.advance(10);
    expect(log).toEqual(["+a", "+b", "-a", "-b"]);
    expect(done).toBe(1);
    expect(p.busy).toBe(false);
    expect(clock.delta()).toBe(0);
  });

  test("batches queue back to back; finish() jumps to the end", () => {
    const ends: number[] = [];
    const p = new TimelinePlayer();
    p.enqueue(tl([["a", 0, 1]]), () => ends.push(1));
    p.enqueue(tl([["a", 0, 1]]), () => ends.push(2));
    expect(p.end).toBeCloseTo(2);
    p.advance(1.5);
    expect(ends).toEqual([1]);
    expect(p.active()[0]!.key).toBe("b1:a");
    expect(p.active()[0]!.t).toBeCloseTo(0.5);
    p.finish();
    expect(ends).toEqual([1, 2]);
  });

  test("zero-duration clips (reduced motion) apply instantly", () => {
    const log: string[] = [];
    const p = new TimelinePlayer({ onStart: (c) => log.push(`+${c.clip.key}`), onEnd: (c) => log.push(`-${c.clip.key}`) });
    p.enqueue(tl([["a", 0, 0]], "step"));
    p.advance(0);
    expect(log).toEqual(["+a", "-a"]);
  });

  test("identical input -> identical samples (determinism)", () => {
    const run = () => {
      const p = new TimelinePlayer();
      p.enqueue(tl([["a", 0, 0.7], ["b", 0.2, 0.9]], "easeOutBack"));
      const out: number[] = [];
      for (let i = 0; i < 40; i++) {
        p.advance(1 / 30);
        for (const s of p.active(0.25)) out.push(Math.round(s.p * 1e6));
      }
      return out;
    };
    expect(run()).toEqual(run());
  });

  test("overshoot amplifies only the part past 1", () => {
    const c = tl([["a", 0, 1]], "easeOutBack").clips[0]!;
    expect(ease(c, 0, 0.5)).toBeCloseTo(0);
    expect(ease(c, 1, 0.5)).toBeCloseTo(1);
    const peak = (o: number) => Math.max(...Array.from({ length: 50 }, (_, i) => ease(c, i / 49, o)));
    expect(peak(0.5)).toBeGreaterThan(peak(0));
  });

  const wasm = resolve(import.meta.dir, "../../core-wasm/core.wasm");
  test.skipIf(!existsSync(wasm))("plays a real core/anim timeline to completion", async () => {
    const geo = await CoreGeo.instantiate(readFileSync(wasm));
    const real = geo.animTimeline([
      { type: "tilePlaced", player: 0, x: 1, y: 0, rot: 0, tile: "D" },
      { type: "figurePlaced", player: 0, x: 1, y: 0, feature: 0, figure: "meeple" },
    ]);
    const kinds: string[] = [];
    const p = new TimelinePlayer({ onEnd: (c) => kinds.push(c.clip.kind) });
    let done = false;
    p.enqueue(real, () => (done = true));
    for (let i = 0; i < 600 && !done; i++) p.advance(1 / 60);
    expect(done).toBe(true);
    expect(kinds.sort()).toEqual(["cameraFocus", "lifeRise", "meepleHopIn", "tileDrop", "wallExtrude"]);
  });
});
