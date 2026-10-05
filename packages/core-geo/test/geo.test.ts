// End-to-end: the committed core.wasm in packages/core-wasm (rebuild with `bun run build:wasm` there)
// -> CoreGeo wrapper -> decoders.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CoreGeo } from "../src";

const wasmPath = resolve(import.meta.dir, "../../core-wasm/core.wasm");
const has = existsSync(wasmPath);

describe.skipIf(!has)("core-geo over core.wasm", async () => {
  const geo = has ? await CoreGeo.instantiate(readFileSync(wasmPath)) : (null as unknown as CoreGeo);

  test("registry ids round-trip", () => {
    const ids = geo.tileIds();
    expect(ids.length).toBeGreaterThan(10);
    ids.forEach((id, i) => expect(geo.indexOf(id)).toBe(i));
    expect(geo.indexOf("nope")).toBe(-1);
  });

  test("2D decode: features, paths in range, anchors in tile", () => {
    for (const id of geo.tileIds()) {
      const g = geo.tile2d(id);
      expect(g.meta.id).toBe(id);
      expect(g.features.length).toBe(g.meta.featureCount);
      for (const f of g.features) {
        expect(f.anchor[0]).toBeGreaterThan(0);
        expect(f.anchor[0]).toBeLessThan(1);
      }
      for (const p of g.paths) expect(p.points.length).toBeGreaterThanOrEqual(4);
      // every field and city has a region path
      for (const f of g.features) {
        if (f.kind !== "field" && f.kind !== "city") continue;
        expect(g.paths.some((p) => p.feature === f.index && p.role === "region")).toBe(true);
      }
    }
  });

  test("3D decode: valid indexed mesh with groups, props and anchors", () => {
    const g = geo.tile3d("fx-city3-road", 24);
    const nv = g.positions.length / 3;
    expect(g.normals.length).toBe(nv * 3);
    expect(g.uvs.length).toBe(nv * 2);
    expect(g.featureIds.length).toBe(nv);
    for (const i of g.indices) expect(i).toBeLessThan(nv);
    expect(g.groups.map((x) => x.material)).toEqual(["terrain", "wall", "slab"]);
    expect(g.anchors.length).toBe(g.features.length);
    expect(g.props.some((p) => p.prop === "gatehouse")).toBe(true);
    expect(g.props.some((p) => p.prop === "house")).toBe(true);
    expect(g.slab).toBeCloseTo(0.09, 5);
    const flat = geo.tile3d("fx-city3-road", 24, 0);
    expect(flat.slab).toBe(0);
    expect(flat.groups.some((x) => x.material === "slab")).toBe(false);
  });

  test("figures: meeple + abbot, standing + lying", () => {
    for (const shape of ["meeple", "abbot"] as const) {
      for (const pose of ["standing", "lying"] as const) {
        const f = geo.figure(shape, pose);
        expect(f.shape).toBe(shape);
        expect(f.pose).toBe(pose);
        expect(f.outline.length).toBeGreaterThan(40);
        expect(f.indices.length % 3).toBe(0);
        expect(f.thickness).toBeCloseTo(0.35, 5);
      }
    }
  });

  test("anim timeline JSON", () => {
    const tl = geo.animTimeline(
      [
        { type: "tilePlaced", player: 0, x: 0, y: 1, rot: 0, tile: "fx-cap" },
        { type: "figurePlaced", player: 0, x: 0, y: 1, feature: 0, figure: "meeple" },
      ],
      { style: "cartoon" },
    );
    expect(tl.version).toBe(1);
    expect(tl.style).toBe("cartoon");
    expect(tl.clips.map((c) => c.kind)).toEqual(["cameraFocus", "tileDrop", "lifeRise", "wallExtrude", "meepleHopIn"]);
    expect(tl.duration).toBeGreaterThan(0);
    const reduced = geo.animTimeline([{ type: "tilePlaced", player: 0, x: 0, y: 1, rot: 0, tile: "fx-cap" }], { style: "reduced" });
    expect(reduced.duration).toBe(0);
  });
});
