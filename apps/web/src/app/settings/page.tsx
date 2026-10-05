"use client";

import { CameraPicker, GeneralSettings, StyleCarousel } from "@/components/style/style-settings";

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="font-display text-4xl tracking-tight">Settings</h1>
      <p className="mt-1 text-muted-foreground">Saved on this device. Styles switch live, even mid-game.</p>

      <section className="mt-6 rounded-3xl border border-border/80 bg-card/80 p-5 shadow-sm">
        <h2 className="mb-3 font-display text-2xl">Board style</h2>
        <StyleCarousel />
      </section>

      <section className="mt-5 rounded-3xl border border-border/80 bg-card/80 p-5 shadow-sm">
        <h2 className="mb-3 font-display text-2xl">Camera</h2>
        <CameraPicker />
      </section>

      <section className="mt-5 rounded-3xl border border-border/80 bg-card/80 p-5 shadow-sm">
        <h2 className="mb-1 font-display text-2xl">Play & accessibility</h2>
        <GeneralSettings />
      </section>

      <section className="mt-5 rounded-3xl border border-border/80 bg-card/80 p-5 text-sm shadow-sm">
        <h2 className="mb-2 font-display text-2xl">Keyboard</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5">
          {[
            ["← ↑ → ↓", "Move between legal spots"],
            ["R / E · Shift+R / Q", "Rotate clockwise · counter-clockwise (scroll also rotates over a spot)"],
            ["Enter / Space", "Place the tile, then confirm with no figure"],
            ["1–9", "Place a figure on the listed feature"],
            ["S", "Skip the figure"],
            ["A", "Recall your abbot"],
            ["Esc", "Pick another spot"],
            ["U / Ctrl+Z", "Undo (offline games)"],
            ["+ / − / F", "Zoom in, out, fit board"],
            ["Shift + arrows", "Pan the board"],
            ["H", "Hint (when enabled)"],
          ].map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="font-mono text-xs font-semibold">{k}</dt>
              <dd className="text-muted-foreground">{v}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
