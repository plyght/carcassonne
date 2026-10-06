// Painted tile bitmaps: each (tile, rotation, palette, size) is painted once, off the
// critical path (a time-sliced queue), turned into a blob URL and cached. The board and
// thumbnails draw these as <image>/<img>; until a bitmap is ready they show the vector art.

import { useSyncExternalStore } from "react";

import type { TileDef } from "@carcassonne/game-client";

import type { BoardPalette } from "../palette";
import type { TileArtSource } from "../tile-art";
import { paintTile } from "./paint";
import { canPaint, ctx2d, makeCanvas, type AnyCanvas, type IllustratedTile } from "./types";

/** Bitmap sizes (px per tile edge). The board picks one from zoom × devicePixelRatio. */
export const TILE_LEVELS = [128, 256, 512, 768] as const;

export function levelFor(devicePx: number): number {
  for (const l of TILE_LEVELS) if (l >= devicePx * 0.92) return l;
  return TILE_LEVELS[TILE_LEVELS.length - 1]!;
}

interface Job {
  key: string;
  tile: IllustratedTile;
  rot: number;
  palette: BoardPalette;
  size: number;
  urgent: boolean;
}

const ready = new Map<string, string>();
const queued = new Map<string, Job>();
const listeners = new Set<() => void>();
const MAX_ENTRIES = 700;
let version = 0;
let scheduled = false;
let notifyPending = false;
/** Total paint time, for the dev overlay / perf checks. */
export const tileCacheStats = { painted: 0, paintMs: 0 };

const keyOf = (id: string, rot: number, paletteId: string, size: number) => `${id}|${((rot % 4) + 4) % 4}|${paletteId}|${size}`;

function notify() {
  if (notifyPending) return;
  notifyPending = true;
  const run = () => {
    notifyPending = false;
    version++;
    for (const l of listeners) l();
  };
  if (typeof requestAnimationFrame !== "undefined") requestAnimationFrame(run);
  else setTimeout(run, 0);
}

function toUrl(c: AnyCanvas): Promise<string> {
  if ("toBlob" in c)
    return new Promise((res, rej) => c.toBlob((b) => (b ? res(URL.createObjectURL(b)) : rej(new Error("toBlob failed"))), "image/png"));
  return c.convertToBlob({ type: "image/png" }).then((b) => URL.createObjectURL(b));
}

function evict() {
  if (ready.size <= MAX_ENTRIES) return;
  // Maps iterate in insertion order: drop the oldest.
  for (const [k, url] of ready) {
    ready.delete(k);
    URL.revokeObjectURL(url);
    if (ready.size <= MAX_ENTRIES * 0.9) break;
  }
}

let quietUntil = 0;

/** Hold off painting while the user pans or zooms (keeps frames smooth); vector/lower-level art shows meanwhile. */
export function deferTilePainting(ms = 160) {
  quietUntil = Math.max(quietUntil, performance.now() + ms);
}

function pump() {
  scheduled = false;
  const start = performance.now();
  if (start < quietUntil) {
    scheduled = true;
    setTimeout(pump, quietUntil - start + 5);
    return;
  }
  while (queued.size && performance.now() - start < 7) {
    let job: Job | undefined;
    for (const j of queued.values()) {
      if (j.urgent) {
        job = j;
        break;
      }
      job ??= j;
    }
    if (!job) break;
    queued.delete(job.key);
    const t0 = performance.now();
    const c = makeCanvas(job.size, job.size);
    paintTile(ctx2d(c), { tile: job.tile, rot: job.rot, palette: job.palette.illustrated!, paletteId: job.palette.id, size: job.size });
    tileCacheStats.painted++;
    tileCacheStats.paintMs += performance.now() - t0;
    const key = job.key;
    toUrl(c).then(
      (url) => {
        ready.set(key, url);
        evict();
        notify();
      },
      () => {},
    );
  }
  if (queued.size) schedule();
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  setTimeout(pump, 0);
}

/** Whether painted art applies (palette has an illustrated set, source has geo data, browser can paint). */
export function canIllustrate(source: TileArtSource, palette: BoardPalette): boolean {
  return !!palette.illustrated && !!source.illustrated && canPaint();
}

/**
 * URL of the painted tile at `size`, or the best other size already painted, or null.
 * Requests the exact size (or queues it) as a side effect.
 */
/**
 * `version` (from useTileCacheVersion) is unused here but must be passed by React
 * callers: it makes the call an input-dependent expression, so memoizing compilers
 * (React Compiler) re-run it when bitmaps become ready.
 */
export function tileImage(source: TileArtSource, def: TileDef, rot: number, palette: BoardPalette, size: number, urgent = true, _version = 0): string | null {
  if (!canIllustrate(source, palette)) return null;
  const key = keyOf(def.id, rot, palette.id, size);
  const hit = ready.get(key);
  if (hit) return hit;
  const q = queued.get(key);
  if (q) q.urgent ||= urgent;
  else {
    const tile = source.illustrated!(def);
    if (!tile) return null;
    queued.set(key, { key, tile, rot, palette, size, urgent });
    schedule();
  }
  // Fallback: nearest other level, larger first.
  let best: string | null = null;
  let bestScore = Infinity;
  for (const l of TILE_LEVELS) {
    if (l === size) continue;
    const u = ready.get(keyOf(def.id, rot, palette.id, l));
    if (!u) continue;
    const score = l > size ? l - size : (size - l) * 4;
    if (score < bestScore) {
      best = u;
      bestScore = score;
    }
  }
  return best;
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const getVersion = () => version;
const getServerVersion = () => 0;

/** Re-render when painted tiles become available. */
export function useTileCacheVersion(): number {
  return useSyncExternalStore(subscribe, getVersion, getServerVersion);
}

/** Painted art for a single tile (thumbnails). */
export function useTileImage(source: TileArtSource, def: TileDef | undefined, rot: number, palette: BoardPalette, size: number): string | null {
  const version = useTileCacheVersion();
  return def ? tileImage(source, def, rot, palette, size, true, version) : null;
}
