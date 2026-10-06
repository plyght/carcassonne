import { describe, expect, test } from "bun:test";

import { CoreGeo } from "@carcassonne/core-geo";
import { loadCoreKit } from "@carcassonne/core-wasm";
import { catalogFromKit } from "@carcassonne/game-client/engine";

import { createGeoArt, createGeoFigures } from "./geo-art";
import { buildProceduralArt } from "./procedural-art";
import { rotatePoint } from "./tile-art";
import { CLASSIC_PALETTE } from "./palette";
import { getStyle, hudPalette, is3DStyle, renderableStyle, STYLE_PACKS } from "./styles";

const kit = await loadCoreKit();
const geo = new CoreGeo(kit.instance);
const TILES = catalogFromKit(kit).all();
const BASE_TILES = TILES.filter((t) => t.set === "base" && !t.features.some((f) => f.kind === "garden"));

describe("core-geo tile art", () => {
  const art = createGeoArt(geo);
  for (const def of TILES) {
    test(`tile ${def.id}: layers, feature areas and anchors`, () => {
      const a = art.get(def);
      expect(a.layers!.length).toBeGreaterThan(0);
      expect(a.features.length).toBe(def.features.length);
      for (const f of a.features) {
        if (f.kind !== "river") expect(f.area?.length ?? 0).toBeGreaterThan(0);
        expect(f.anchor[0]).toBeGreaterThan(0);
        expect(f.anchor[0]).toBeLessThan(100);
        expect(f.anchor[1]).toBeGreaterThan(0);
        expect(f.anchor[1]).toBeLessThan(100);
      }
      const pennants = def.features.reduce((n, f) => n + (f.pennants ?? 0), 0);
      expect(a.features.reduce((n, f) => n + f.pennants.length, 0)).toBe(pennants);
    });
  }
  test("figure outlines fit the 24-unit token box", () => {
    const figs = createGeoFigures(geo);
    for (const k of ["meeple", "abbot"] as const) {
      const nums = figs.path(k).match(/-?\d+(\.\d+)?/g)!.map(Number);
      expect(Math.min(...nums)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...nums)).toBeLessThanOrEqual(24);
    }
  });
});

describe("procedural tile art", () => {
  for (const def of BASE_TILES) {
    test(`tile ${def.id}: every feature gets geometry and an in-tile anchor`, () => {
      const art = buildProceduralArt(def);
      expect(art.features.length).toBe(def.features.length);
      for (const f of art.features) {
        if (f.kind === "field" || f.kind === "city" || f.kind === "cloister") expect(f.area?.length ?? 0).toBeGreaterThan(0);
        if (f.kind === "road") expect(f.line?.length ?? 0).toBeGreaterThan(0);
        expect(f.anchor[0]).toBeGreaterThan(0);
        expect(f.anchor[0]).toBeLessThan(100);
        expect(f.anchor[1]).toBeGreaterThan(0);
        expect(f.anchor[1]).toBeLessThan(100);
      }
      const pennants = def.features.reduce((n, f) => n + (f.pennants ?? 0), 0);
      expect(art.features.reduce((n, f) => n + f.pennants.length, 0)).toBe(pennants);
    });
  }

  test("rotatePoint turns clockwise", () => {
    expect(rotatePoint([50, 0], 1)).toEqual([100, 50]);
    expect(rotatePoint([50, 0], 2)).toEqual([50, 100]);
    expect(rotatePoint([50, 0], 3)).toEqual([0, 50]);
  });
});

describe("style registry", () => {
  test("six styles; three.js styles are playable, storybook falls back to classic", () => {
    expect(STYLE_PACKS.map((s) => s.id).sort()).toEqual(["blueprint", "cartoon", "classic", "diorama", "storybook", "tabletop"]);
    for (const id of ["tabletop", "cartoon", "diorama"] as const) {
      expect(renderableStyle(id).id).toBe(id);
      expect(is3DStyle(getStyle(id))).toBe(true);
      expect(hudPalette(getStyle(id))).toBe(CLASSIC_PALETTE);
    }
    expect(renderableStyle("storybook").id).toBe("classic");
    expect(is3DStyle(getStyle("classic"))).toBe(false);
    expect(renderableStyle("blueprint").id).toBe("blueprint");
    expect(getStyle("nope").id).toBe("classic");
  });
});
