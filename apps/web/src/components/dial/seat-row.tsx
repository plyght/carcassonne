"use client";

// Player seat row: meeple avatar, name, meeple colour picker and who plays the seat
// (a human, or a bot tier). Built from DialKit surfaces plus the game's MeeplePicker
// and DialSelect; wraps to two lines on narrow screens.

import { Bot, User } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import type { AiTier } from "@carcassonne/protocol";
import type { PlayerColorId, PlayerMeta } from "@carcassonne/game-client";
import { FigureIcon, PLAYER_COLORS, proceduralFigures } from "@carcassonne/render-classic";

import { MeeplePicker } from "./meeple-picker";
import { DialSelect, type SelectItem } from "./primitives";

export const TIER_INFO: { id: AiTier; label: string; hint: string }[] = [
  { id: "easy", label: "Easy", hint: "Greedy, loves placing meeples" },
  { id: "medium", label: "Medium", hint: "Weighs completion and meeple economy" },
  { id: "hard", label: "Hard", hint: "Searches the remaining tiles" },
  { id: "expert", label: "Expert", hint: "Deeper search, models opponents" },
];

export type SeatController = "human" | `bot:${AiTier}`;

export function seatController(s: PlayerMeta): SeatController {
  return s.kind === "bot" ? `bot:${s.tier ?? "medium"}` : "human";
}

export function controllerItems(allowBots: boolean): SelectItem[] {
  const human: SelectItem = { value: "human", label: "Human", hint: "Plays on this device", icon: <User className="size-4" /> };
  if (!allowBots) return [human];
  return [
    human,
    ...TIER_INFO.map((t) => ({ value: `bot:${t.id}`, label: `${t.label} bot`, hint: t.hint, icon: <Bot className="size-4" /> })),
  ];
}

export function PlayerSeatRow({
  index,
  seat,
  onName,
  onColor,
  onController,
  takenBy,
  allowBots = true,
}: {
  index: number;
  seat: PlayerMeta;
  onName(name: string): void;
  onColor(c: PlayerColorId): void;
  onController(c: SeatController): void;
  takenBy?: Partial<Record<PlayerColorId, string>>;
  allowBots?: boolean;
}) {
  const app = PLAYER_COLORS[seat.color];
  const reduced = useReducedMotion();
  return (
    <motion.li
      layout={!reduced}
      initial={reduced ? false : { opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduced ? undefined : { opacity: 0, y: -6, transition: { duration: 0.12 } }}
      transition={{ type: "spring", visualDuration: 0.3, bounce: 0.15 }}
      className="carc-seat"
      data-seat={index}
      data-kind={seat.kind}
    >
      <span className="carc-seat-avatar" style={{ background: `color-mix(in oklch, ${app.fill} 16%, transparent)` }}>
        <motion.span key={seat.color} initial={reduced ? false : { y: -6, scale: 0.8 }} animate={{ y: 0, scale: 1 }} transition={{ type: "spring", visualDuration: 0.3, bounce: 0.5 }} style={{ display: "grid" }}>
          <FigureIcon figures={proceduralFigures} fill={app.fill} ink={app.ink} marker={app.marker} size={32} title={`${app.label} meeple`} />
        </motion.span>
      </span>
      <input
        className="carc-seat-name"
        value={seat.name}
        onChange={(e) => onName(e.target.value.slice(0, 20))}
        aria-label={`Seat ${index + 1} name`}
        spellCheck={false}
        autoComplete="off"
      />
      <MeeplePicker className="carc-seat-color" label={`Seat ${index + 1} colour`} value={seat.color} onChange={onColor} takenBy={takenBy} />
      <div className="carc-seat-who">
        <DialSelect compact label={`Seat ${index + 1} player`} value={seatController(seat)} items={controllerItems(allowBots)} onChange={(v) => onController(v as SeatController)} testId={`seat-${index}-player`} />
      </div>
    </motion.li>
  );
}
