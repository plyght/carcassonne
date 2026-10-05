import { describe, expect, test } from "bun:test";

import { BASE_TILES } from "@carcassonne/game-client/dev-engine";

import { buildProceduralArt } from "./procedural-art";
import { rotatePoint } from "./tile-art";
import { getStyle, renderableStyle, STYLE_PACKS } from "./styles";

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
  test("six styles; 3D ones fall back to classic for rendering", () => {
    expect(STYLE_PACKS.map((s) => s.id).sort()).toEqual(["blueprint", "cartoon", "classic", "diorama", "storybook", "tabletop"]);
    expect(renderableStyle("tabletop").id).toBe("classic");
    expect(renderableStyle("blueprint").id).toBe("blueprint");
    expect(getStyle("nope").id).toBe("classic");
  });
});
