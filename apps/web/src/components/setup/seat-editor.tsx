"use client";

// Seats for a local game: one PlayerSeatRow (DialKit-styled) per seat. Colours stay
// unique: picking a colour another seat has swaps the two.

import { AnimatePresence } from "motion/react";

import type { PlayerColorId, PlayerMeta } from "@carcassonne/game-client";

import { PlayerSeatRow, TIER_INFO, type SeatController } from "@/components/dial/seat-row";

export const TIERS = TIER_INFO;

const BOT_NAMES = ["Abbess Hild", "Brother Odo", "Sir Gawain", "Lady Ysolde", "Old Tom", "Matilda"];

export function botName(i: number) {
  return BOT_NAMES[i % BOT_NAMES.length]!;
}

export function SeatEditor({
  seats,
  onChange,
  allowBots = true,
}: {
  seats: PlayerMeta[];
  onChange(seats: PlayerMeta[]): void;
  allowBots?: boolean;
}) {
  const set = (i: number, patch: Partial<PlayerMeta>) => {
    const next = seats.map((s, k) => (k === i ? { ...s, ...patch } : s));
    if (patch.color) {
      const other = seats.findIndex((s, k) => k !== i && s.color === patch.color);
      if (other >= 0) next[other] = { ...next[other]!, color: seats[i]!.color };
    }
    onChange(next);
  };
  const controller = (i: number, c: SeatController) => {
    const s = seats[i]!;
    if (c === "human") set(i, { kind: "human", tier: undefined, name: s.kind === "bot" ? `Player ${i + 1}` : s.name });
    else set(i, { kind: "bot", tier: c.slice(4) as PlayerMeta["tier"], name: s.kind === "bot" ? s.name : botName(i) });
  };
  return (
    <ol className="carc-seats" data-testid="seats">
      <AnimatePresence initial={false}>
        {seats.map((s, i) => {
          const takenBy: Partial<Record<PlayerColorId, string>> = {};
          seats.forEach((o, k) => {
            if (k !== i) takenBy[o.color] = `seat ${k + 1}`;
          });
          return (
            <PlayerSeatRow
              key={i}
              index={i}
              seat={s}
              takenBy={takenBy}
              allowBots={allowBots}
              onName={(name) => set(i, { name })}
              onColor={(color) => set(i, { color })}
              onController={(c) => controller(i, c)}
            />
          );
        })}
      </AnimatePresence>
    </ol>
  );
}
