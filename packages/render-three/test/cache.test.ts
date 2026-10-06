import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CoreGeo } from "@carcassonne/core-geo";
import { TileGeometryCache, blurGrid, rotXZ } from "../src/tile-cache";
import { PropKit, VARIANTS } from "../src/props";

const wasm = resolve(import.meta.dir, "../../core-wasm/core.wasm");

describe.skipIf(!existsSync(wasm))("tile geometry cache", async () => {
  const geo = existsSync(wasm) ? await CoreGeo.instantiate(readFileSync(wasm)) : (null as unknown as CoreGeo);

  test("caches per (tile, rot, resolution) and decodes each tile once", () => {
    let calls = 0;
    const src = { tile3d: (t: string | number, r?: number, s?: number) => (calls++, geo.tile3d(t, r, s)) };
    const c = new TileGeometryCache(src);
    const a = c.get("D", 0, 16);
    expect(c.get("D", 0, 16)).toBe(a);
    expect(c.get("D", 4, 16)).toBe(a); // rot is mod 4
    const b = c.get("D", 1, 16);
    expect(b).not.toBe(a);
    expect(calls).toBe(1); // rotation reuses the decoded tile
    c.get("D", 1, 24);
    expect(calls).toBe(2);
    expect(c.size).toBe(3);
    expect(c.hits).toBe(2);
    expect(c.misses).toBe(3);
    // geometries share one vertex buffer per (tile, rot)
    if (b.wall) expect(b.wall.getAttribute("position")).toBe(b.ground.getAttribute("position"));
    c.clear();
    expect(c.size).toBe(0);
  });

  test("rotation is baked in: positions, anchors and props turn clockwise", () => {
    const c = new TileGeometryCache(geo);
    const r0 = c.get("D", 0, 16);
    const r1 = c.get("D", 1, 16);
    const p0 = r0.ground.getAttribute("position");
    const p1 = r1.ground.getAttribute("position");
    for (let i = 0; i < p0.count; i += 37) {
      const [x, z] = rotXZ(p0.getX(i), p0.getZ(i), 1);
      expect(p1.getX(i)).toBeCloseTo(x, 5);
      expect(p1.getZ(i)).toBeCloseTo(z, 5);
      expect(p1.getY(i)).toBeCloseTo(p0.getY(i), 6);
    }
    r0.anchors.forEach((a, i) => {
      const [x, z] = rotXZ(a.x, a.z, 1);
      expect(r1.anchors[i]!.x).toBeCloseTo(x, 5);
      expect(r1.anchors[i]!.z).toBeCloseTo(z, 5);
      expect(r1.anchors[i]!.yaw).toBeCloseTo(a.yaw - Math.PI / 2, 5);
    });
    expect(r1.props.length).toBe(r0.props.length);
  });

  test("material attributes: kind weights, AO, slab flag; feature triangles", () => {
    const g = new TileGeometryCache(geo).get("D", 0, 24);
    const kind = g.ground.getAttribute("aKind");
    const mat = g.ground.getAttribute("aMat");
    let slab = 0;
    for (let i = 0; i < mat.count; i++) {
      const s = mat.getY(i);
      if (s === 1) slab++;
      else {
        const w = kind.getX(i) + kind.getY(i) + kind.getZ(i) + kind.getW(i);
        expect(w).toBeGreaterThan(0.99);
        expect(w).toBeLessThan(1.01);
        expect(mat.getX(i)).toBeGreaterThan(0);
        expect(mat.getX(i)).toBeLessThanOrEqual(1);
      }
    }
    expect(slab).toBeGreaterThan(0);
    // every field/city/road feature of D has highlight triangles
    g.features.forEach((_f, i) => expect(g.featureTriangles.get(i)?.length ?? 0).toBeGreaterThan(0));
    expect(g.featureGrid.length).toBe(25 * 25);
  });

  test("grid blur keeps weights normalised", () => {
    const R = 4;
    const a = new Float32Array((R + 1) * (R + 1) * 2);
    for (let i = 0; i < (R + 1) * (R + 1); i++) a[i * 2 + (i % 3 === 0 ? 0 : 1)] = 1;
    blurGrid(a, R, 2, 2);
    for (let i = 0; i < (R + 1) * (R + 1); i++) expect(a[i * 2]! + a[i * 2 + 1]!).toBeCloseTo(1, 5);
  });

  test("prop kit: one cached model per (prop, variant) with palette parts", () => {
    const kit = new PropKit(geo, { rounded: false });
    for (const [prop, n] of Object.entries(VARIANTS) as [keyof typeof VARIANTS, number][]) {
      for (let v = 0; v < n; v++) {
        const g = kit.geometry(prop, v);
        expect(g.getAttribute("position").count).toBeGreaterThan(0);
        expect(g.getAttribute("aPart").count).toBe(g.getAttribute("position").count);
        expect(kit.geometry(prop, v + n)).toBe(g); // variant % count
      }
    }
  });
});
