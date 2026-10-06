"use client";

import { getStyle } from "@carcassonne/render-classic";

import { DialSurface } from "@/components/dial/primitives";
import { CameraControl, PlaySettings, QualityControl, SoundControls, StyleSelect } from "@/components/dial/table-controls";
import { StylePreview } from "@/components/style/style-preview";
import { useSettings } from "@/lib/settings";

function Card({ title, sub, children, label }: { title: string; sub?: string; children: React.ReactNode; label?: string }) {
  return (
    <section className="carc-sheet mt-[var(--sp-6)]" aria-label={label}>
      <h2 className="carc-heading">{title}</h2>
      {sub ? <p className="carc-sub">{sub}</p> : null}
      <DialSurface className="mt-[var(--sp-4)]">{children}</DialSurface>
    </section>
  );
}

export default function SettingsPage() {
  const settings = useSettings();
  const style = getStyle(settings.style);
  return (
    <div className="carc-page">
      <h1 className="carc-page-title">Settings</h1>
      <p className="carc-page-lead">Your settings are saved on this device, and styles switch live, even in the middle of a game.</p>

      <section className="carc-sheet mt-[var(--sp-6)] overflow-hidden p-0!" aria-label="Visual style">
        <StylePreview key={style.id} style={style} live3d className="h-60" />
        <div className="p-[var(--sp-6)] max-[519px]:p-[var(--sp-4)]">
          <h2 className="carc-heading">
            {style.name} <span className="carc-tag align-middle">{style.dimension.toUpperCase()}</span>
          </h2>
          <p className="carc-sub">{style.description}</p>
          <DialSurface className="carc-dial-stack mt-[var(--sp-4)] gap-[var(--sp-3)]!">
            <StyleSelect />
            <CameraControl stacked />
            <QualityControl />
          </DialSurface>
        </div>
      </section>

      <Card title="Sound" sub="Volume buses for the soundscape, music and effects.">
        <SoundControls />
      </Card>

      <Card title="Play & accessibility">
        <PlaySettings />
      </Card>

      <section className="carc-sheet mt-[var(--sp-6)]">
        <h2 className="carc-heading">Keyboard</h2>
        <dl className="mt-[var(--sp-4)] grid grid-cols-[auto_1fr] gap-x-[var(--sp-6)] gap-y-[var(--sp-2)] text-[length:var(--fs-body)]">
          {[
            ["← ↑ → ↓", "Move between legal spots"],
            ["R / E · Shift+R / Q", "Rotate clockwise · counter-clockwise (scroll or the dial also rotate)"],
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
              <dt className="font-mono font-medium whitespace-nowrap text-[var(--text-1)]">{k}</dt>
              <dd className="text-pretty text-[var(--text-2)]">{v}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
