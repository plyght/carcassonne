// The three.js side of the 3D board. Only `board-3d.tsx` imports this, and only through a
// dynamic import(), so three.js and @carcassonne/render-three land in their own chunk that
// 2D players never download.

import type { CoreGeo } from "@carcassonne/core-geo";
import { BoardRenderer, THREE_STYLE_ENTRIES, type Tier } from "@carcassonne/render-three";

export type { BoardRenderer };

export interface CreateBoardOptions {
  style: string;
  camera: "top" | "tabletop" | "orbit" | "cinematic";
  tier: Tier;
  reducedMotion: boolean;
}

/** Mount a BoardRenderer for a registered 3D style on `canvas` (WebGPU, else WebGL2). */
export async function createBoard(canvas: HTMLCanvasElement, geo: CoreGeo, o: CreateBoardOptions): Promise<BoardRenderer> {
  const entry = THREE_STYLE_ENTRIES.find((e) => e.id === o.style) ?? THREE_STYLE_ENTRIES[0]!;
  return entry.mount(canvas, geo, { camera: o.camera, tier: o.tier, reducedMotion: o.reducedMotion });
}

/** Screen position (client px) of a board-space point, e.g. a cell centre, through the live camera. */
export function projectToClient(r: BoardRenderer, bx: number, bz: number, y = 0.02): { x: number; y: number } {
  const cam = r.rig.active;
  // Vector3 borrowed from the camera so this module needs no direct three import.
  const v = cam.position.clone().set(bx, y, bz).project(cam);
  const rect = r.canvas.getBoundingClientRect();
  return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
}
