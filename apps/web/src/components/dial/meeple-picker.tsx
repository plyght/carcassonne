"use client";

// Meeple colour picker: the classic meeple silhouette as swatches (each with its
// colour-blind marker). A DialKit-styled radio group: arrows move and select, the
// chosen meeple hops up onto a felt spot with a spring. Colours another seat already
// uses are dimmed (their names say whose they are); picking one swaps colours.

import { useRef, type KeyboardEvent } from "react";

import { motion, useReducedMotion } from "motion/react";

import type { PlayerColorId } from "@carcassonne/game-client";
import { FigureIcon, PLAYER_COLOR_ORDER, PLAYER_COLORS, proceduralFigures } from "@carcassonne/render-classic";
import { cn } from "@carcassonne/ui/lib/utils";

export function MeeplePicker({
  label,
  value,
  onChange,
  colors = PLAYER_COLOR_ORDER,
  takenBy,
  size = 26,
  className,
}: {
  label: string;
  value: PlayerColorId;
  onChange(c: PlayerColorId): void;
  colors?: PlayerColorId[];
  /** Colour → who else uses it (shown as a badge, e.g. the seat number). */
  takenBy?: Partial<Record<PlayerColorId, string>>;
  size?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const onKey = (e: KeyboardEvent) => {
    const i = colors.indexOf(value);
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!d && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    e.stopPropagation();
    const next = e.key === "Home" ? 0 : e.key === "End" ? colors.length - 1 : (i + d + colors.length) % colors.length;
    onChange(colors[next]!);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
  };
  return (
    <div ref={ref} className={cn("carc-meeples", className)} role="radiogroup" aria-label={label} onKeyDown={onKey}>
      {colors.map((c) => {
        const app = PLAYER_COLORS[c];
        const on = c === value;
        const other = takenBy?.[c];
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={other ? `${app.label} (swap with ${other})` : app.label}
            title={other ? `${app.label}: swap with ${other}` : app.label}
            tabIndex={on ? 0 : -1}
            data-color={c}
            data-taken={other && !on ? "true" : undefined}
            className="carc-meeple"
            onClick={() => onChange(c)}
          >
            <motion.span
              style={{ display: "grid" }}
              initial={false}
              animate={on ? { y: -3, scale: 1.14 } : { y: 0, scale: 1 }}
              whileHover={on || reduced ? undefined : { y: -1.5, scale: 1.06 }}
              whileTap={{ scale: 0.92 }}
              transition={reduced ? { duration: 0 } : { type: "spring", visualDuration: 0.28, bounce: 0.45 }}
            >
              <FigureIcon figures={proceduralFigures} fill={app.fill} ink={app.ink} marker={app.marker} size={size} outline={on ? "rgba(0,0,0,0.7)" : "rgba(0,0,0,0.45)"} />
            </motion.span>
          </button>
        );
      })}
    </div>
  );
}
