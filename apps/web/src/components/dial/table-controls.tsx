"use client";

// The board/view controls as DialKit parts, shared by the in-game HUD panel and the
// Settings page. All state lives in the settings store and the plain actions in
// lib/board-controls, so these are just a control surface.

import { Slider, Toggle } from "dialkit";
import { Armchair, Clapperboard, Map as MapIcon, Monitor, Moon, Rotate3d, Sun, type LucideIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";

import { CAMERA_MODES, getStyle, STYLE_PACKS, type CameraMode, type StyleId } from "@carcassonne/render-classic";

import { selectCamera, selectMotion, selectStyle, selectTier, setVolume } from "@/lib/board-controls";
import { updateSettings, useSettings, type Settings, type VolumeBus } from "@/lib/settings";
import { removeKey } from "@/lib/storage";

import { DialButton, DialField, DialSelect, DialSurface, Segmented, SegmentedRow, type SelectItem } from "./primitives";

export const CAMERA_ICONS: Record<CameraMode, LucideIcon> = {
  "top-down": MapIcon,
  tabletop: Armchair,
  orbit: Rotate3d,
  cinematic: Clapperboard,
};

export function styleSwatch(id: StyleId): string {
  const s = getStyle(id).swatch;
  return `linear-gradient(135deg, ${s[0]} 0%, ${s[1]} 55%, ${s[2]} 100%)`;
}

export const STYLE_ITEMS: SelectItem[] = STYLE_PACKS.map((s) => ({
  value: s.id,
  label: s.name,
  hint: s.tagline,
  swatch: styleSwatch(s.id),
  disabled: s.status !== "ready",
  badge: s.status !== "ready" ? "Coming soon" : s.dimension.toUpperCase(),
}));

/** Board style, with a swatch per style. Switches live. */
export function StyleSelect({ testId = "style-select" }: { testId?: string }) {
  const { style } = useSettings();
  return (
    <DialField hint={getStyle(style).tagline}>
      <DialSelect label="Board style" value={style} items={STYLE_ITEMS} onChange={(v) => selectStyle(v as StyleId)} testId={testId} />
    </DialField>
  );
}

/** Camera mode; 2D styles lock to top-down. `value`/`onChange` let a live board report free orbit. */
export function CameraControl({ value, onChange, stacked }: { value?: CameraMode; onChange?(c: CameraMode): void; stacked?: boolean }) {
  const settings = useSettings();
  const style = getStyle(settings.style);
  const current = value ?? (style.cameras.includes(settings.camera) ? settings.camera : style.defaultCamera);
  return (
    <DialField hint={style.dimension === "2d" ? "2D styles lock to the top-down camera." : CAMERA_MODES.find((c) => c.id === current)?.description}>
      <SegmentedRow
        label="Camera"
        testId="camera-switcher"
        stacked={stacked}
        value={current}
        onChange={(c) => (onChange ? onChange(c) : selectCamera(c))}
        options={CAMERA_MODES.map((c) => {
          const Icon = CAMERA_ICONS[c.id];
          return {
            value: c.id,
            label: c.label,
            icon: <Icon />,
            showLabel: stacked,
            disabled: !style.cameras.includes(c.id),
            title: `${c.label}: ${c.description}`,
            data: { camera: c.id },
          };
        })}
      />
    </DialField>
  );
}

/** Icon-only camera switch for compact HUDs (replay viewer). */
export function CameraIconSwitch({ value, onChange }: { value: CameraMode; onChange(c: CameraMode): void }) {
  return (
    <DialSurface>
      <Segmented
        label="Camera"
        data-testid="camera-switcher"
        className="carc-seg-tabs carc-seg-compact"
        value={value}
        onChange={onChange}
        options={CAMERA_MODES.map((c) => {
          const Icon = CAMERA_ICONS[c.id];
          return { value: c.id, label: c.label, icon: <Icon />, title: `${c.label}: ${c.description}`, data: { camera: c.id } };
        })}
      />
    </DialSurface>
  );
}

export function QualityControl({ hint = true }: { hint?: boolean }) {
  const { tier } = useSettings();
  return (
    <DialField hint={hint ? "Auto picks Low on phones and integrated GPUs. Low turns off shadows and post effects." : undefined}>
      <SegmentedRow
        label="3D quality"
        value={tier}
        onChange={selectTier}
        options={[
          { value: "auto", label: "Auto" },
          { value: "low", label: "Low" },
          { value: "medium", label: "Med" },
          { value: "high", label: "High" },
        ]}
      />
    </DialField>
  );
}

export function MotionControl({ hint }: { hint?: string }) {
  const { motion } = useSettings();
  return (
    <DialField hint={hint}>
      <SegmentedRow
        label="Motion"
        value={motion}
        onChange={selectMotion}
        options={[
          { value: "system", label: "System" },
          { value: "reduced", label: "Reduced" },
          { value: "full", label: "Full" },
        ]}
      />
    </DialField>
  );
}

const BUSES: { bus: VolumeBus; label: string }[] = [
  { bus: "master", label: "Master" },
  { bus: "music", label: "Music" },
  { bus: "sfx", label: "Effects" },
  { bus: "ambience", label: "Ambience" },
];

export function SoundControls() {
  const { volume } = useSettings();
  return (
    <div className="carc-dial-stack" data-testid="sound-controls">
      {BUSES.map(({ bus, label }) => (
        <Slider key={bus} label={label} value={volume[bus]} min={0} max={100} step={1} unit="%" onChange={(v) => setVolume(bus, v)} />
      ))}
    </div>
  );
}

export function ThemeControl() {
  const { theme, setTheme } = useTheme();
  return (
    <SegmentedRow
      label="Theme"
      value={(theme ?? "system") as "light" | "dark" | "system"}
      onChange={(v) => setTheme(v)}
      options={[
        { value: "light", label: "Light", icon: <Sun />, showLabel: true },
        { value: "dark", label: "Dark", icon: <Moon />, showLabel: true },
        { value: "system", label: "System", icon: <Monitor />, showLabel: true },
      ]}
    />
  );
}

/** Play & accessibility settings (Settings page). */
export function PlaySettings() {
  const s = useSettings();
  const set = (p: Partial<Settings>) => updateSettings(p);
  return (
    <div className="carc-dial-stack">
      <ThemeControl />
      <MotionControl hint="Reduced turns tile drops, hops and camera moves into instant changes." />
      <SegmentedRow
        label="Text size"
        value={s.uiScale}
        onChange={(v) => set({ uiScale: v })}
        options={[
          { value: 1, label: "A" },
          { value: 1.1, label: "A+" },
          { value: 1.25, label: "A++" },
        ]}
      />
      <SegmentedRow
        label="Bot speed"
        value={s.botSpeed}
        onChange={(v) => set({ botSpeed: v })}
        options={[
          { value: "slow", label: "Slow" },
          { value: "normal", label: "Normal" },
          { value: "fast", label: "Fast" },
        ]}
      />
      <DialField hint="The three steps of a turn over the board: what to do now, and what just scored and why.">
        <Toggle label="Turn guide" checked={s.showTurnGuide} onChange={(v) => set({ showTurnGuide: v })} />
      </DialField>
      <DialField hint="Show the first-game tips again in your next game against bots.">
        <DialButton
          variant="ghost"
          onClick={() => {
            removeKey("carc.coach.v1");
            toast.success("Tips will show in your next game");
          }}
        >
          Show first-game tips again
        </DialButton>
      </DialField>
      <DialField hint="Show counts of tiles left in the draw pile.">
        <Toggle label="Remaining-tiles panel" checked={s.showRemaining} onChange={(v) => set({ showRemaining: v })} />
      </DialField>
      <DialField hint="Don’t show emoji reactions from other players.">
        <Toggle label="Hide all reactions" checked={s.hideReactions} onChange={(v) => set({ hideReactions: v })} />
      </DialField>
      <DialField hint="Hot-seat: hide your tile until you’re at the device.">
        <Toggle label="Pass-the-device screen" checked={s.hotseatPrivacy} onChange={(v) => set({ hotseatPrivacy: v })} />
      </DialField>
      <DialField hint="Offline games: show a Hint button (best move by Medium AI).">
        <Toggle label="Hints" checked={s.showHints} onChange={(v) => set({ showHints: v })} />
      </DialField>
    </div>
  );
}
