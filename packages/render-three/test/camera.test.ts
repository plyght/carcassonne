import { describe, expect, test } from "bun:test";
import * as THREE from "three/webgpu";
import { CameraRig, eyeOf, lerpState } from "../src/camera";

function projected(rig: CameraRig, b: { minX: number; minZ: number; maxX: number; maxZ: number }) {
  rig.snap();
  const cam = rig.perspective;
  const out: [number, number][] = [];
  for (const [x, z] of [
    [b.minX, b.minZ],
    [b.maxX, b.minZ],
    [b.minX, b.maxZ],
    [b.maxX, b.maxZ],
  ] as const) {
    const v = new THREE.Vector3(x, 0, z).project(cam);
    out.push([v.x, v.y]);
  }
  return out;
}

describe("camera rig", () => {
  test("tabletop framing keeps the whole board on screen", () => {
    for (const aspect of [1.5, 1.33, 0.7]) {
      for (const b of [
        { minX: -3, minZ: -2, maxX: 8, maxZ: 7 },
        { minX: 0, minZ: 0, maxX: 1, maxZ: 1 },
        { minX: -6, minZ: -1, maxX: 6, maxZ: 3 },
      ]) {
        const rig = new CameraRig();
        rig.setAspect(aspect);
        rig.setBounds(b);
        const pts = projected(rig, b);
        for (const [x, y] of pts) {
          expect(Math.abs(x)).toBeLessThanOrEqual(1.0);
          expect(Math.abs(y)).toBeLessThanOrEqual(1.0);
        }
        // and fills a good part of it
        const span = Math.max(...pts.map((p) => Math.abs(p[0])), ...pts.map((p) => Math.abs(p[1])));
        expect(span).toBeGreaterThan(0.7);
      }
    }
  });

  test("top-down settles into the orthographic camera; transitions are smooth", () => {
    const rig = new CameraRig();
    rig.setAspect(1.6);
    rig.setBounds({ minX: 0, minZ: 0, maxX: 4, maxZ: 3 });
    rig.snap();
    rig.setMode("top");
    expect(rig.useOrtho).toBe(false);
    let prev = eyeOf(rig.current);
    for (let i = 0; i < 300; i++) {
      rig.update(1 / 60);
      const e = eyeOf(rig.current);
      // no frame jumps more than a fraction of the total travel
      expect(Math.hypot(e[0] - prev[0], e[2] - prev[2])).toBeLessThan(3);
      prev = e;
    }
    expect(rig.useOrtho).toBe(true);
    expect(rig.active).toBe(rig.ortho);
  });

  test("lerpState takes the short way round in yaw", () => {
    const a = { tx: 0, ty: 0, tz: 0, yaw: Math.PI - 0.1, pitch: 1, distance: 10, fov: 30 };
    const b = { ...a, yaw: -Math.PI + 0.1 };
    const m = lerpState(a, b, 0.5);
    expect(Math.abs(Math.abs(m.yaw) - Math.PI)).toBeLessThan(1e-9);
  });
});
