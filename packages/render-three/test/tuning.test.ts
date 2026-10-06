import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CoreGeo } from "@carcassonne/core-geo";
import { EASINGS, type AnimTimeline } from "@carcassonne/core-geo/anim";
import { STYLE_PACKS, StylePackError } from "../src/styles";
import { applyStyleOverrides, clipBases, REFERENCE_EVENTS, retimeTimeline, sampleTransition, setStyleOverrides, stylePackJSON, withAnimTuning } from "../src/tuning";

describe("style overrides", () => {
  test("merge a patch and validate it like a style.json", () => {
    const base = STYLE_PACKS.tabletop;
    const out = applyStyleOverrides(base, { lighting: { sun: { intensity: 3.1 } }, post: { tiltShift: null } });
    expect(out.lighting.sun.intensity).toBe(3.1);
    expect(out.lighting.sun.azimuth).toBe(base.lighting.sun.azimuth);
    expect(out.post.tiltShift).toBeNull();
    expect(base.lighting.sun.intensity).not.toBe(3.1); // base untouched
    expect(() => applyStyleOverrides(base, { palette: { grass: "green" } })).toThrow(StylePackError);
  });

  test("setStyleOverrides hands the renderer a pack object; JSON round-trips", () => {
    let got: unknown = null;
    const r = { styleId: "cartoon", setStyle: (s: unknown) => (got = s) };
    const pack = setStyleOverrides(r, { post: { saturation: 1.4 } });
    expect(got).toBe(pack);
    expect(JSON.parse(stylePackJSON(pack)).post.saturation).toBe(1.4);
  });
});

describe("anim retiming", () => {
  const tl: AnimTimeline = {
    version: 1,
    style: "realistic",
    duration: 0.85,
    clips: [
      { key: "e0:tileDrop", kind: "tileDrop", event: 0, start: 0, duration: 0.35, easing: "easeOutCubic", target: { type: "tile", x: 0, y: 0, rot: 0, tile: "D" }, params: { fromHeight: 0.6 } },
      { key: "e0:lifeRise", kind: "lifeRise", event: 0, start: 0.35, duration: 0.5, easing: "easeOutCubic", target: { type: "tile", x: 0, y: 0, rot: 0, tile: "D" } },
    ],
  };
  const bases = clipBases(tl);

  test("shifts, rescales and reshapes only the tuned kinds", () => {
    const out = retimeTimeline(tl, { tileDrop: { at: 0.1, duration: 0.7, transition: { type: "easing", duration: 0.7, ease: [0, 0, 1, 1] }, params: { fromHeight: 1.2 } } }, bases);
    const drop = out.clips[0]!;
    expect(drop.start).toBeCloseTo(0.1);
    expect(drop.duration).toBeCloseTo(0.7);
    expect(drop.params?.fromHeight).toBe(1.2);
    expect((EASINGS as Record<string, (t: number) => number>)[drop.easing]!(0.5)).toBeCloseTo(0.5, 3);
    expect(out.clips[1]).toEqual(tl.clips[1]!);
    expect(out.duration).toBeCloseTo(0.85);
  });

  test("keeps clip-relative pacing (speed, final scoring) and leaves reduced-motion clips alone", () => {
    const fast: AnimTimeline = { ...tl, clips: tl.clips.map((c) => ({ ...c, start: c.start / 2, duration: c.duration / 2 })) };
    const out = retimeTimeline(fast, { lifeRise: { at: 0.45, duration: 1 } }, bases);
    expect(out.clips[1]!.start).toBeCloseTo(0.175 + 0.05);
    expect(out.clips[1]!.duration).toBeCloseTo(0.5);
    const reduced: AnimTimeline = { ...tl, clips: tl.clips.map((c) => ({ ...c, duration: 0, easing: "step" })) };
    expect(retimeTimeline(reduced, { tileDrop: { at: 1, duration: 1 } }, bases).clips[0]!.duration).toBe(0);
  });

  test("springs run to settle and end at 1; bezier endpoints are exact", () => {
    const s = sampleTransition({ type: "spring", visualDuration: 0.4, bounce: 0.4 }, 0.4);
    expect(s.total).toBeGreaterThan(0.4);
    expect(s.at(0)).toBe(0);
    expect(s.at(1)).toBe(1);
    expect(Math.max(...Array.from({ length: 50 }, (_, i) => s.at(i / 50)))).toBeGreaterThan(1); // overshoots
    const e = sampleTransition({ type: "easing", duration: 0.3, ease: [0.33, 1, 0.68, 1] }, 0.3);
    expect(e.at(0)).toBe(0);
    expect(e.at(1)).toBe(1);
  });
});

const wasm = resolve(import.meta.dir, "../../core-wasm/core.wasm");

describe.skipIf(!existsSync(wasm))("withAnimTuning", async () => {
  const geo = existsSync(wasm) ? await CoreGeo.instantiate(readFileSync(wasm)) : (null as unknown as CoreGeo);

  test("wraps a real geo provider: reference clips exist and tuning applies at play time", () => {
    const ref = geo.animTimeline(REFERENCE_EVENTS);
    const bases = clipBases(ref);
    for (const k of ["tileDrop", "lifeRise", "wallExtrude", "meepleHopIn", "meepleHopOut", "featurePulse", "scorePopup", "cameraFocus"] as const) expect(bases[k]).toBeDefined();
    let tuning: { tuning: Parameters<typeof retimeTimeline>[1]; bases: typeof bases } | null = null;
    const wrapped = withAnimTuning(geo, () => tuning);
    expect(wrapped.animTimeline(REFERENCE_EVENTS)).toEqual(ref);
    expect(wrapped.tile3d("D", 8).positions.length).toBeGreaterThan(0); // other methods pass through
    tuning = { tuning: { tileDrop: { at: 0, duration: 1.5 } }, bases };
    const drop = wrapped.animTimeline(REFERENCE_EVENTS).clips.find((c) => c.kind === "tileDrop")!;
    expect(drop.duration).toBeCloseTo(1.5);
  });
});
