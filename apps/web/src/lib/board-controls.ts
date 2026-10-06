"use client";

// Board view controls as plain state + actions (no JSX), so any control surface (the
// HUD switcher, the settings page, or a future panel library) can drive them without
// touching game logic. Persisted values live in the settings store (./settings).

import { useCallback, useEffect, useState } from "react";

import { effectiveCamera, getStyle, renderableStyle, type CameraMode, type StyleId, type StylePack } from "@carcassonne/render-classic";

import { getSettings, updateSettings, useSettings, type Settings, type VolumeBus } from "./settings";

/** Switch the board style live (keeps the camera if the new style supports it). */
export function selectStyle(id: StyleId): void {
  const prev = getStyle(getSettings().style);
  const next = getStyle(id);
  // 2D styles lock the camera to top-down: entering 3D starts on the style's default view
  const camera = prev.dimension === "2d" && next.dimension === "3d" ? next.defaultCamera : effectiveCamera(next, getSettings().camera);
  updateSettings({ style: id, camera });
}

/** Persist a camera mode. */
export function selectCamera(camera: CameraMode): void {
  updateSettings({ camera });
}

export function selectTier(tier: Settings["tier"]): void {
  updateSettings({ tier });
}

export function selectMotion(motion: Settings["motion"]): void {
  updateSettings({ motion });
}

/** Set one volume bus (0–100). The audio mixer reads the levels from settings. */
export function setVolume(bus: VolumeBus, level: number): void {
  const v = Math.max(0, Math.min(100, Math.round(level)));
  updateSettings({ volume: { ...getSettings().volume, [bus]: v } });
}

/** 3D could not start on this device: fall back to the guaranteed Classic style. */
export function fallbackToClassic(): void {
  updateSettings({ style: "classic", camera: "top-down" });
}

/** The style the board draws with right now. */
export function useBoardStyle(): StylePack {
  return renderableStyle(useSettings().style);
}

/**
 * Camera in use on a board: the saved setting, or what the renderer reports (dragging
 * a 3D board switches it to free orbit without changing the saved preference).
 */
export function useBoardCamera(style: StylePack): { camera: CameraMode; choose(c: CameraMode): void; report(c: CameraMode): void } {
  const saved = useSettings().camera;
  const [camera, setCamera] = useState<CameraMode>(() => effectiveCamera(style, saved));
  useEffect(() => setCamera(effectiveCamera(style, saved)), [style, saved]);
  const choose = useCallback((c: CameraMode) => {
    setCamera(c);
    selectCamera(c);
  }, []);
  return { camera, choose, report: setCamera };
}
