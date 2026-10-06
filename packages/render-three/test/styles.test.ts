import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_STYLE, STYLE_IDS, STYLE_PACKS, StylePackError, effectOn, getStylePack, loadStylePack } from "../src/styles";
import { THREE_STYLE_ENTRIES } from "../src";

const raw = (id: string) => JSON.parse(readFileSync(resolve(import.meta.dir, `../../assets/styles/${id}/style.json`), "utf8"));

describe("style packs", () => {
  test("every built-in pack loads from its style.json", () => {
    for (const id of STYLE_IDS) {
      const p = loadStylePack(raw(id));
      expect(p.id).toBe(id);
      expect(p).toEqual(STYLE_PACKS[id]);
      expect(p.palette.players.length).toBeGreaterThanOrEqual(5);
      expect(p.palette.roofs.length).toBeGreaterThan(0);
    }
    expect(STYLE_PACKS.tabletop.shading).toBe("pbr");
    expect(STYLE_PACKS.cartoon.shading).toBe("toon");
    expect(STYLE_PACKS.cartoon.materials.outline).not.toBeNull();
    expect(STYLE_PACKS.cartoon.anim.preset).toBe("cartoon");
  });

  test("missing keys fall back to defaults", () => {
    const p = loadStylePack({ id: "mini", name: "Mini", palette: { grass: "#112233" } });
    expect(p.palette.grass).toBe("#112233");
    expect(p.palette.road).toBe(DEFAULT_STYLE.palette.road);
    expect(p.terrain).toEqual(DEFAULT_STYLE.terrain);
    expect(p.fog).toBeNull();
  });

  test("validation errors", () => {
    const bad = (j: unknown) => expect(() => loadStylePack(j)).toThrow(StylePackError);
    bad(null);
    bad({ name: "x" });
    bad({ id: "Bad Id", name: "x" });
    bad({ id: "a", name: "A", palette: { grass: "green" } });
    bad({ id: "a", name: "A", palette: { nope: "#000000" } });
    bad({ id: "a", name: "A", terrain: { tileGap: "1" } });
    bad({ id: "a", name: "A", shading: "watercolour-ish" });
    bad({ id: "a", name: "A", palette: { players: ["#000000"] } });
    bad({ id: "a", name: "A", post: { ssao: { radius: 1, intensity: 1, tiers: ["ultra"] } } });
    bad({ id: "a", name: "A", materials: { outline: { color: "black", thickness: 1 } } });
    expect(() => getStylePack("nope")).toThrow(StylePackError);
  });

  test("effect tiers", () => {
    expect(effectOn(STYLE_PACKS.tabletop.post.tiltShift, "high")).toBe(true);
    expect(effectOn(STYLE_PACKS.tabletop.post.tiltShift, "low")).toBe(false);
    expect(effectOn(STYLE_PACKS.cartoon.post.tiltShift, "high")).toBe(false);
    expect(effectOn(STYLE_PACKS.diorama.post.tiltShift, "medium")).toBe(true);
  });

  test("registry entries for the web style registry", () => {
    expect(THREE_STYLE_ENTRIES.map((e) => e.id)).toEqual([...STYLE_IDS]);
    for (const e of THREE_STYLE_ENTRIES) {
      expect(e.kind).toBe("3d");
      expect(e.cameras).toEqual(["top", "tabletop", "orbit", "cinematic"]);
      expect(typeof e.mount).toBe("function");
    }
  });
});
