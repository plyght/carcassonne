import { describe, expect, test } from "bun:test";
import { rotatePoint } from "@carcassonne/core-geo";
import { cellAt, featureAt, featureAtGrid, featureExtent, opposingPort, rayPlaneY, rotateCanonical, rotatePorts, toCanonical, type ExtentTile } from "../src/picking";

describe("picking math", () => {
  test("ray vs table plane", () => {
    expect(rayPlaneY([0, 10, 0], [0, -1, 0], 0)).toEqual([0, 0, 0]);
    const h = rayPlaneY([1, 2, 3], [1, -1, 0.5], 0)!;
    expect(h[0]).toBeCloseTo(3);
    expect(h[1]).toBe(0);
    expect(h[2]).toBeCloseTo(4);
    expect(rayPlaneY([0, 1, 0], [1, 0, 0], 0)).toBeNull(); // parallel
    expect(rayPlaneY([0, 1, 0], [0, 1, 0], 0)).toBeNull(); // pointing away
  });

  test("cells: cell (x, y) spans [x, x+1] x [y, y+1]", () => {
    expect(cellAt(0.2, 0.9)).toEqual({ x: 0, y: 0 });
    expect(cellAt(-0.1, 2.5)).toEqual({ x: -1, y: 2 });
    expect(cellAt(3, -3)).toEqual({ x: 3, y: -3 });
  });

  test("rotation matches core-geo and inverts", () => {
    for (let r = 0; r < 4; r++) {
      for (const [x, y] of [
        [0.1, 0.2],
        [0.5, 0],
        [0.9, 0.7],
      ] as const) {
        expect(rotateCanonical(x, y, r)).toEqual(rotatePoint(x, y, r));
        const [a, b] = rotateCanonical(x, y, r);
        const [u, v] = toCanonical(a, b, r);
        expect(u).toBeCloseTo(x);
        expect(v).toBeCloseTo(y);
      }
    }
    // north edge middle, one clockwise turn -> east edge middle
    expect(rotateCanonical(0.5, 0, 1)).toEqual([1, 0.5]);
  });

  test("feature lookup on the per-vertex grid", () => {
    // 2x2 quads (3x3 vertices): left column feature 1, right columns 2, centre none
    const R = 2;
    const ids = [1, 2, 2, 1, 255, 2, 1, 2, 2];
    expect(featureAtGrid(ids, R, 0, 0)).toBe(1);
    expect(featureAtGrid(ids, R, 0.95, 0.5)).toBe(2);
    // the centre vertex has no feature: nearest ring wins
    expect([1, 2]).toContain(featureAtGrid(ids, R, 0.5, 0.5));
    // placed tile rotated once: placed (1, 0) (NE corner) is canonical (0, 0)
    expect(featureAt({ featureIds: ids, resolution: R, anchors: [] }, 1, 0.99, 0.01)).toBe(1);
    // anchors win within their radius
    expect(featureAt({ featureIds: ids, resolution: R, anchors: [{ x: 0.9, z: 0.9 }, { x: 0.1, z: 0.1 }] }, 0, 0.12, 0.1)).toBe(1);
  });

  test("ports rotate and oppose like engine/tile.zig", () => {
    expect(rotatePorts(0b1, 1)).toBe(0b1000);
    expect(rotatePorts(1 << 9, 1)).toBe(0b1);
    expect(rotatePorts(0xfff, 3)).toBe(0xfff);
    expect(opposingPort(0)).toBe(8);
    expect(opposingPort(1)).toBe(7);
    expect(opposingPort(3)).toBe(11);
  });

  test("feature extent follows ports across tiles", () => {
    // road running E-W through three tiles (feature 0 = road on ports 4 and 10),
    // plus a dead-end tile to the north that does not connect (field only)
    const road: ExtentTile = { rot: 0, ports: [(1 << 4) | (1 << 10), 0b111 | (1 << 3) | (1 << 11), (1 << 5) | (1 << 9) | (0b111 << 6)] };
    const field: ExtentTile = { rot: 0, ports: [0xfff] };
    const board = new Map<string, ExtentTile>([
      ["0,0", road],
      ["1,0", road],
      ["2,0", { ...road, rot: 2 }],
      ["1,-1", field],
    ]);
    const at = (x: number, y: number) => board.get(`${x},${y}`);
    const ext = featureExtent(at, 0, 0, 0);
    expect(ext.map((c) => `${c.x},${c.y},${c.feature}`).sort()).toEqual(["0,0,0", "1,0,0", "2,0,0"]);
    // the north field of the middle tile joins the field tile above
    const f = featureExtent(at, 1, 0, 1);
    expect(f.some((c) => c.x === 1 && c.y === -1)).toBe(true);
    // west neighbour shares the north field; the east neighbour is turned
    // 180 degrees, so its *south-defined* field (feature 2) is now north
    expect(f.some((c) => c.x === 0 && c.y === 0 && c.feature === 1)).toBe(true);
    expect(f.some((c) => c.x === 2 && c.y === 0 && c.feature === 2)).toBe(true);
    expect(f.some((c) => c.x === 2 && c.y === 0 && c.feature === 1)).toBe(false);
  });
});
