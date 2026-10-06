"use client";

// Live tuning mode (`?tune`, or the backquote key in development): DialKit panels edit
// the active style pack / 2D palette and the anim clip timings, and the board picks the
// edits up through this store. Nothing here is persisted to settings; the panels export
// the tuned style.json / palette for pasting into the repo.

import { useEffect, useSyncExternalStore } from "react";

import type { BoardPalette } from "@carcassonne/render-classic";
import type { StylePack } from "@carcassonne/render-three/styles";
import type { AnimTuning, ClipBase } from "@carcassonne/render-three/tuning";
import type { ClipKind } from "@carcassonne/core-geo/anim";

interface TuneState {
  /** Tuned 3D packs by style id. */
  packs: Record<string, StylePack>;
  /** Tuned 2D palettes by palette id. */
  palettes: Record<string, BoardPalette>;
  anim: { tuning: AnimTuning; bases: Partial<Record<ClipKind, ClipBase>> } | null;
}

let state: TuneState = { packs: {}, palettes: {}, anim: null };
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const tuneStore = {
  get: () => state,
  setPack(id: string, pack: StylePack | null) {
    const packs = { ...state.packs };
    if (pack) packs[id] = pack;
    else delete packs[id];
    state = { ...state, packs };
    emit();
  },
  setPalette(id: string, palette: BoardPalette | null) {
    const palettes = { ...state.palettes };
    if (palette) palettes[id] = palette;
    else delete palettes[id];
    state = { ...state, palettes };
    emit();
  },
  setAnim(anim: TuneState["anim"]) {
    state = { ...state, anim };
    emit();
  },
  /** Read at play time by the 3D board's geo wrapper. */
  anim: () => state.anim,
};

/** A tuned 3D pack for `id`, if tune mode edited it. */
export function useTunedPack(id: string): StylePack | null {
  return useSyncExternalStore(subscribe, () => state.packs[id] ?? null, () => null);
}

/** `base`, or its tuned version when tune mode is editing it. */
export function useTunedPalette(base: BoardPalette): BoardPalette {
  return useSyncExternalStore(subscribe, () => state.palettes[base.id] ?? base, () => base);
}

// ── the flag ────────────────────────────────────────────────────────────────

const FLAG = "carc.tune";
const flagListeners = new Set<() => void>();

let consumedSearch: string | null = null;

function readFlag(): boolean {
  try {
    // a ?tune / ?tune=0 in a new URL sets the sticky flag once; later toggles win
    if (window.location.search !== consumedSearch) {
      consumedSearch = window.location.search;
      const q = new URLSearchParams(consumedSearch);
      if (q.has("tune")) sessionStorage.setItem(FLAG, q.get("tune") !== "0" ? "1" : "0");
    }
    return sessionStorage.getItem(FLAG) === "1";
  } catch {
    return false;
  }
}

export function setTuneMode(on: boolean) {
  try {
    sessionStorage.setItem(FLAG, on ? "1" : "0");
  } catch {}
  for (const l of flagListeners) l();
}

/** `?tune` (sticky for the tab, `?tune=0` turns it off); in development the ` key toggles it. */
export function useTuneMode(): boolean {
  const on = useSyncExternalStore(
    (fn) => {
      flagListeners.add(fn);
      return () => flagListeners.delete(fn);
    },
    readFlag,
    () => false,
  );
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "`" || (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable))) return;
      setTuneMode(!readFlag());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return on;
}
