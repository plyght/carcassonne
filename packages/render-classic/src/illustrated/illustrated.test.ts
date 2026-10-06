import { describe, expect, test } from "bun:test";

import { CoreGeo } from "@carcassonne/core-geo";
import { loadCoreKit } from "@carcassonne/core-wasm";
import { catalogFromKit } from "@carcassonne/game-client/engine";

import { createGeoArt } from "../geo-art";
import { BLUEPRINT_PALETTE, CLASSIC_PALETTE } from "../palette";
import { canIllustrate, levelFor, TILE_LEVELS } from "./cache";
import { hashString, periodicNoise, rng } from "./noise";
import { paintTile } from "./paint";
import type { TextureSet } from "./textures";
import type { Ctx2D } from "./types";

const kit = await loadCoreKit();
const geo = new CoreGeo(kit.instance);
const TILES = catalogFromKit(kit).all();
const art = createGeoArt(geo);

/** A 2D context that records calls and never throws (Bun has no canvas). */
function recordingContext() {
  const calls: { op: string; args: unknown[] }[] = [];
  const gradient = { addColorStop() {} };
  const pattern = { setTransform() {} };
  const target: Record<string, unknown> = {
    createRadialGradient: () => gradient,
    createLinearGradient: () => gradient,
    createPattern: () => pattern,
    setLineDash: () => {},
  };
  const ctx = new Proxy(target, {
    get(t, k: string) {
      if (k in t) return t[k];
      return (...args: unknown[]) => {
        for (const a of args) if (typeof a === "number" && !Number.isFinite(a)) throw new Error(`${k}: non-finite argument`);
        calls.push({ op: k, args });
      };
    },
    set(t, k: string, v) {
      t[k] = v;
      return true;
    },
  });
  return { ctx: ctx as unknown as Ctx2D, calls };
}

const fakeTextures: TextureSet = { size: 64, grass: {}, ground: {}, sand: {}, water: {}, grain: {} } as unknown as TextureSet;

describe("illustrated tile data (core-geo regions + 3D props)", () => {
  for (const def of TILES) {
    test(`tile ${def.id}: paths, props and feature kinds`, () => {
      const t = art.illustrated!(def)!;
      expect(t.id).toBe(def.id);
      expect(t.features).toEqual(def.features.map((f) => f.kind));
      expect(t.paths.length).toBeGreaterThan(0);
      for (const p of t.props) {
        expect(p.x).toBeGreaterThanOrEqual(-0.01);
        expect(p.x).toBeLessThanOrEqual(1.01);
        expect(p.y).toBeGreaterThanOrEqual(-0.01);
        expect(p.y).toBeLessThanOrEqual(1.01);
      }
      if (def.features.some((f) => f.kind === "city")) expect(t.props.some((p) => p.prop === "house")).toBe(true);
      if (def.features.some((f) => f.kind === "cloister")) expect(t.props.some((p) => p.prop === "chapel")).toBe(true);
    });
  }
});

describe("tile painter", () => {
  const pal = CLASSIC_PALETTE.illustrated!;
  for (const def of TILES) {
    test(`tile ${def.id}: paints every rotation with finite coordinates`, () => {
      const t = art.illustrated!(def)!;
      for (const rot of [0, 1, 2, 3]) {
        const { ctx, calls } = recordingContext();
        paintTile(ctx, { tile: t, rot, palette: pal, paletteId: "classic", size: 128, textures: fakeTextures });
        expect(calls.length).toBeGreaterThan(20);
      }
    });
  }

  test("painting is deterministic", () => {
    const def = TILES.find((d) => d.id === "C")!;
    const a = recordingContext();
    const b = recordingContext();
    paintTile(a.ctx, { tile: art.illustrated!(def)!, rot: 1, palette: pal, paletteId: "classic", size: 256, textures: fakeTextures });
    paintTile(b.ctx, { tile: art.illustrated!(def)!, rot: 1, palette: pal, paletteId: "classic", size: 256, textures: fakeTextures });
    expect(JSON.stringify(a.calls)).toBe(JSON.stringify(b.calls));
  });
});

describe("noise and levels", () => {
  test("periodic noise tiles seamlessly", () => {
    const n = periodicNoise(8, 3);
    for (const v of [0, 0.13, 0.5, 0.91]) expect(n(0, v)).toBeCloseTo(n(1, v), 6);
    for (const u of [0, 0.27, 0.66]) expect(n(u, 0)).toBeCloseTo(n(u, 1), 6);
  });
  test("seeded rng and hash are stable", () => {
    expect(hashString("C")).toBe(hashString("C"));
    const a = rng(42);
    const b = rng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
  test("bitmap level covers the device pixels", () => {
    expect(levelFor(60)).toBe(128);
    expect(levelFor(200)).toBe(256);
    expect(levelFor(600)).toBe(768);
    expect(levelFor(5000)).toBe(TILE_LEVELS[TILE_LEVELS.length - 1]!);
  });
  test("Blueprint stays vector; no painting without a canvas", () => {
    expect(BLUEPRINT_PALETTE.illustrated).toBeUndefined();
    expect(canIllustrate(art, BLUEPRINT_PALETTE)).toBe(false);
    expect(canIllustrate(art, CLASSIC_PALETTE)).toBe(false); // Bun: no DOM canvas
  });
});
