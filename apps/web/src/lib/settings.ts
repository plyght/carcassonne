"use client";

import { useEffect, useSyncExternalStore } from "react";

import { DEFAULT_STYLE, type CameraMode, type StyleId } from "@carcassonne/render-classic";

import { readJSON, writeJSON } from "./storage";

export interface Settings {
  style: StyleId;
  camera: CameraMode;
  /** "system" follows prefers-reduced-motion. */
  motion: "system" | "reduced" | "full";
  showRemaining: boolean;
  hideReactions: boolean;
  /** Hot-seat: hide the next tile behind a "pass the device" screen. */
  hotseatPrivacy: boolean;
  showHints: boolean;
  botSpeed: "slow" | "normal" | "fast";
  uiScale: 1 | 1.1 | 1.25;
  /** 3D performance tier; "auto" detects from the GPU and device. */
  tier: "auto" | "low" | "medium" | "high";
  /** Volume buses, 0–100 (PRD §6.4). */
  volume: VolumeLevels;
}

export type VolumeBus = "master" | "music" | "sfx" | "ambience";
export type VolumeLevels = Record<VolumeBus, number>;

export const DEFAULT_SETTINGS: Settings = {
  style: DEFAULT_STYLE,
  camera: "top-down",
  motion: "system",
  showRemaining: true,
  hideReactions: false,
  hotseatPrivacy: true,
  showHints: false,
  botSpeed: "normal",
  uiScale: 1,
  tier: "auto",
  volume: { master: 80, music: 60, sfx: 80, ambience: 50 },
};

const KEY = "carc.settings.v1";
const listeners = new Set<() => void>();
let cache: Settings | null = null;

function load(): Settings {
  if (!cache) {
    const saved = readJSON<Partial<Settings>>(KEY, {});
    cache = { ...DEFAULT_SETTINGS, ...saved, volume: { ...DEFAULT_SETTINGS.volume, ...saved.volume } };
  }
  return cache;
}

export function getSettings(): Settings {
  return load();
}

export function updateSettings(patch: Partial<Settings>) {
  cache = { ...load(), ...patch };
  writeJSON(KEY, cache);
  for (const l of listeners) l();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      cache = null;
      fn();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, load, () => DEFAULT_SETTINGS);
}

function subscribeMotion(fn: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", fn);
  return () => mq.removeEventListener("change", fn);
}

export function useReducedMotion(): boolean {
  const { motion } = useSettings();
  const system = useSyncExternalStore(
    subscribeMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
  return motion === "reduced" || (motion === "system" && system);
}

/** Mirrors motion + UI scale settings onto <html> so CSS can react. */
export function useApplyGlobalSettings() {
  const s = useSettings();
  const reduced = useReducedMotion();
  useEffect(() => {
    const el = document.documentElement;
    el.dataset.reducedMotion = String(reduced);
    el.style.fontSize = s.uiScale === 1 ? "" : `${s.uiScale * 100}%`;
  }, [reduced, s.uiScale]);
}

const noop = () => () => {};

/** `?debug` in the URL: FPS / renderer stats overlay on the 3D board. */
export function useDebugFlag(): boolean {
  return useSyncExternalStore(
    noop,
    () => new URLSearchParams(window.location.search).has("debug"),
    () => false,
  );
}

export const BOT_DELAY: Record<Settings["botSpeed"], number> = { slow: 1200, normal: 650, fast: 150 };
