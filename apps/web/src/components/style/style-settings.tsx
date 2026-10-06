"use client";

import { useEffect, useState } from "react";

import { Armchair, ChevronLeft, ChevronRight, Clapperboard, Map as MapIcon, Rotate3d, type LucideIcon } from "lucide-react";
import { useTheme } from "next-themes";

import { cn } from "@carcassonne/ui/lib/utils";
import { CAMERA_MODES, effectiveCamera, getStyle, STYLE_PACKS, type CameraMode, type StyleId } from "@carcassonne/render-classic";

import { selectCamera, selectMotion, selectStyle, selectTier } from "@/lib/board-controls";
import { updateSettings, useSettings, type Settings } from "@/lib/settings";

import { StylePreview } from "./style-preview";

/** Style carousel with a live preview; switching applies immediately (no reload). */
export function StyleCarousel({ compact = false }: { compact?: boolean }) {
  const settings = useSettings();
  const [focus, setFocus] = useState<StyleId>(settings.style);
  // follow the saved style (it is only known after hydration, or changes from elsewhere)
  useEffect(() => setFocus(settings.style), [settings.style]);
  const idx = STYLE_PACKS.findIndex((s) => s.id === focus);
  const style = STYLE_PACKS[idx] ?? STYLE_PACKS[0]!;
  const go = (d: number) => setFocus(STYLE_PACKS[(idx + d + STYLE_PACKS.length) % STYLE_PACKS.length]!.id);
  const selected = settings.style === style.id;

  return (
    <section aria-label="Visual style" className="grid gap-3">
      <div
        className="relative overflow-hidden rounded-2xl border border-border shadow-inner"
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") go(-1);
          if (e.key === "ArrowRight") go(1);
        }}
      >
        <StylePreview key={style.id} style={style} live3d={!compact} className={compact ? "h-40" : "h-64"} />
        <button
          type="button"
          onClick={() => go(-1)}
          className="absolute top-1/2 left-2 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-card/85 shadow hover:bg-card"
          aria-label="Previous style"
        >
          <ChevronLeft className="size-5" />
        </button>
        <button
          type="button"
          onClick={() => go(1)}
          className="absolute top-1/2 right-2 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-card/85 shadow hover:bg-card"
          aria-label="Next style"
        >
          <ChevronRight className="size-5" />
        </button>
      </div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-display text-xl">{style.name}</h3>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-secondary-foreground">
              {style.dimension}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">{compact ? style.tagline : style.description}</p>
        </div>
        <button
          type="button"
          disabled={style.status !== "ready" || selected}
          onClick={() => selectStyle(style.id)}
          className={cn(
            "shrink-0 rounded-xl px-4 py-2 text-sm font-semibold transition-colors",
            selected
              ? "bg-secondary text-secondary-foreground"
              : style.status === "ready"
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-muted text-muted-foreground",
          )}
        >
          {selected ? "In use" : style.status === "ready" ? "Use this style" : "Coming soon"}
        </button>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1" role="listbox" aria-label="Styles">
        {STYLE_PACKS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="option"
            aria-selected={s.id === focus}
            onClick={() => setFocus(s.id)}
            onDoubleClick={() => s.status === "ready" && selectStyle(s.id)}
            className={cn(
              "group relative flex w-24 shrink-0 flex-col items-center gap-1 rounded-xl border p-1.5 text-xs transition-colors",
              s.id === focus ? "border-primary bg-accent/60" : "border-border hover:bg-muted",
            )}
          >
            <span
              className="h-10 w-full rounded-lg"
              style={{ background: `linear-gradient(135deg, ${s.swatch[0]}, ${s.swatch[1]} 60%, ${s.swatch[2]})` }}
            />
            <span className="font-medium">{s.name.replace(" Board", "")}</span>
            {settings.style === s.id ? <span className="absolute top-1 right-1 size-2 rounded-full bg-primary" /> : null}
            {s.status !== "ready" ? <span className="text-[9px] uppercase tracking-wider text-muted-foreground">soon</span> : null}
          </button>
        ))}
      </div>
    </section>
  );
}

const CAMERA_ICONS: Record<CameraMode, LucideIcon> = {
  "top-down": MapIcon,
  tabletop: Armchair,
  orbit: Rotate3d,
  cinematic: Clapperboard,
};

/** Compact HUD camera switcher for 3D styles. */
export function CameraSwitcher({ value, onChange, className }: { value: CameraMode; onChange(c: CameraMode): void; className?: string }) {
  return (
    <div className={cn("flex items-center gap-0.5 rounded-lg bg-muted/70 p-0.5", className)} role="radiogroup" aria-label="Camera" data-testid="camera-switcher">
      {CAMERA_MODES.map((c) => {
        const Icon = CAMERA_ICONS[c.id];
        return (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={value === c.id}
            aria-label={c.label}
            title={`${c.label}: ${c.description}`}
            data-camera={c.id}
            onClick={() => onChange(c.id)}
            className={cn(
              "grid size-7 place-items-center rounded-md transition-colors",
              value === c.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
          </button>
        );
      })}
    </div>
  );
}

export function CameraPicker() {
  const settings = useSettings();
  const style = getStyle(settings.style);
  return (
    <section aria-label="Camera" className="grid gap-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {CAMERA_MODES.map((c) => {
          const supported = style.cameras.includes(c.id);
          const active = effectiveCamera(style, settings.camera) === c.id;
          return (
            <button
              key={c.id}
              type="button"
              disabled={!supported}
              onClick={() => selectCamera(c.id)}
              className={cn(
                "rounded-xl border px-3 py-2 text-left text-sm transition-colors disabled:opacity-45",
                active ? "border-primary bg-accent/60" : "hover:bg-muted",
              )}
              title={c.description}
            >
              <div className="font-semibold">{c.label}</div>
              <div className="text-[11px] leading-snug text-muted-foreground">{c.description}</div>
            </button>
          );
        })}
      </div>
      {style.dimension === "2d" ? <p className="text-xs text-muted-foreground">2D styles lock to the top-down camera.</p> : null}
      <Segmented
        label="3D quality"
        value={settings.tier}
        options={[
          { value: "auto", label: "Auto" },
          { value: "low", label: "Low" },
          { value: "medium", label: "Medium" },
          { value: "high", label: "High" },
        ]}
        onChange={selectTier}
      />
      <p className="px-1 text-xs text-muted-foreground">Auto picks Low on phones and integrated GPUs. Low turns off shadows and post effects.</p>
    </section>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl px-1 py-2">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
      <span className="relative mt-0.5 inline-flex">
        <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="h-6 w-11 rounded-full bg-muted ring-1 ring-border transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring" />
        <span className="absolute top-1 left-1 size-4 rounded-full bg-card shadow transition-transform peer-checked:translate-x-5" />
      </span>
    </label>
  );
}

function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange(v: T): void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-1 py-2">
      <span className="text-sm font-medium">{label}</span>
      <div className="inline-flex rounded-xl bg-muted p-0.5" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-lg px-3 py-1 text-xs font-medium transition-colors",
              o.value === value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function GeneralSettings() {
  const s = useSettings();
  const { theme, setTheme } = useTheme();
  const set = (p: Partial<Settings>) => updateSettings(p);
  return (
    <div className="divide-y divide-border/60">
      <Segmented
        label="Theme"
        value={(theme ?? "system") as "light" | "dark" | "system"}
        options={[
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
          { value: "system", label: "System" },
        ]}
        onChange={(v) => setTheme(v)}
      />
      <Segmented
        label="Motion"
        value={s.motion}
        options={[
          { value: "system", label: "System" },
          { value: "reduced", label: "Reduced" },
          { value: "full", label: "Full" },
        ]}
        onChange={selectMotion}
      />
      <Segmented
        label="Text size"
        value={s.uiScale}
        options={[
          { value: 1, label: "A" },
          { value: 1.1, label: "A+" },
          { value: 1.25, label: "A++" },
        ]}
        onChange={(v) => set({ uiScale: v })}
      />
      <Segmented
        label="Bot speed"
        value={s.botSpeed}
        options={[
          { value: "slow", label: "Slow" },
          { value: "normal", label: "Normal" },
          { value: "fast", label: "Fast" },
        ]}
        onChange={(v) => set({ botSpeed: v })}
      />
      <Toggle label="Remaining-tiles panel" hint="Show counts of tiles left in the draw pile." checked={s.showRemaining} onChange={(v) => set({ showRemaining: v })} />
      <Toggle label="Hide all reactions" hint="Don’t show emoji reactions from other players." checked={s.hideReactions} onChange={(v) => set({ hideReactions: v })} />
      <Toggle label="Pass-the-device screen" hint="Hot-seat: hide your tile until you’re at the device." checked={s.hotseatPrivacy} onChange={(v) => set({ hotseatPrivacy: v })} />
      <Toggle label="Hints" hint="Offline games: show a Hint button (best move by Medium AI)." checked={s.showHints} onChange={(v) => set({ showHints: v })} />
    </div>
  );
}
