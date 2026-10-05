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
}

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
};

const KEY = "carc.settings.v1";
const listeners = new Set<() => void>();
let cache: Settings | null = null;

function load(): Settings {
  if (!cache) cache = { ...DEFAULT_SETTINGS, ...readJSON<Partial<Settings>>(KEY, {}) };
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

export const BOT_DELAY: Record<Settings["botSpeed"], number> = { slow: 1200, normal: 650, fast: 150 };
