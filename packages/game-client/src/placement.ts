// Renderer-agnostic helpers for the "tile in hand" interaction: rotation snapping
// (PRD §6.2) and keyboard navigation between legal cells.

import type { Placement } from "@carcassonne/protocol";

import type { Rot } from "./tiles";

export function legalCells(legal: readonly Placement[]): { x: number; y: number }[] {
  const seen = new Set<string>();
  const out: { x: number; y: number }[] = [];
  for (const p of legal) {
    const k = `${p.x},${p.y}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ x: p.x, y: p.y });
  }
  return out;
}

export function rotationsAt(legal: readonly Placement[], x: number, y: number): Rot[] {
  return legal
    .filter((p) => p.x === x && p.y === y)
    .map((p) => p.rot)
    .sort((a, b) => a - b);
}

/** The legal rotation at (x,y) closest to `desired`, searching in `dir` (+1 cw, -1 ccw). */
export function snapRotation(legal: readonly Placement[], x: number, y: number, desired: number, dir: 1 | -1 = 1): Rot | null {
  const rots = rotationsAt(legal, x, y);
  if (!rots.length) return null;
  for (let i = 0; i < 4; i++) {
    const r = ((((desired + dir * i) % 4) + 4) % 4) as Rot;
    if (rots.includes(r)) return r;
  }
  return rots[0]!;
}

/** Next rotation after `current` at (x,y), or a free rotation when no cell is targeted. */
export function nextRotation(legal: readonly Placement[], cell: { x: number; y: number } | null, current: number, dir: 1 | -1): Rot {
  const free = ((((current + dir) % 4) + 4) % 4) as Rot;
  if (!cell) return free;
  return snapRotation(legal, cell.x, cell.y, free, dir) ?? free;
}

export type Dir = "up" | "down" | "left" | "right";

/** Nearest legal cell from `from` in direction `dir` (cone search), for keyboard play. */
export function stepCell(
  cells: readonly { x: number; y: number }[],
  from: { x: number; y: number } | null,
  dir: Dir,
): { x: number; y: number } | null {
  if (!cells.length) return null;
  if (!from) return cells[0]!;
  const [vx, vy] = dir === "up" ? [0, -1] : dir === "down" ? [0, 1] : dir === "left" ? [-1, 0] : [1, 0];
  let best: { x: number; y: number } | null = null;
  let bestScore = Infinity;
  for (const c of cells) {
    const dx = c.x - from.x;
    const dy = c.y - from.y;
    const along = dx * vx + dy * vy;
    if (along <= 0) continue;
    const across = Math.abs(dx * vy - dy * vx);
    const score = along + across * 2;
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best ?? from;
}
