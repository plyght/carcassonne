"use client";

// Online room clock (PRD §6.6): none / per-turn seconds / bank + increment, as DialKit
// sliders under a segmented mode switch. Values map 1:1 to the server's clockSchema.

import { Slider } from "dialkit";
import { Hourglass, Infinity as InfinityIcon, Timer } from "lucide-react";

import { DialField, SegmentedRow } from "./primitives";

export type RoomClock =
  | { type: "none" }
  | { type: "turn"; turnSeconds: number }
  | { type: "bank"; bankSeconds: number; incrementSeconds: number };

export const DEFAULT_TURN_SECONDS = 45;
export const DEFAULT_BANK = { bankSeconds: 600, incrementSeconds: 10 };

function describe(c: RoomClock): string {
  if (c.type === "none") return "Take as long as you like. Idle players are not timed out.";
  if (c.type === "turn") return `${c.turnSeconds} s per turn. On timeout the server places the tile for you, without a meeple.`;
  return `${Math.round(c.bankSeconds / 60)} min each, +${c.incrementSeconds} s per move, chess style. Run out and the server plays for you.`;
}

export function ClockSettings({ value, onChange }: { value: RoomClock; onChange(c: RoomClock): void }) {
  return (
    <div className="carc-dial-stack" data-testid="clock-settings" data-clock={value.type}>
      <DialField hint={describe(value)}>
        <SegmentedRow
          label="Clock"
          testId="clock-mode"
          value={value.type}
          onChange={(t) =>
            onChange(t === "none" ? { type: "none" } : t === "turn" ? { type: "turn", turnSeconds: DEFAULT_TURN_SECONDS } : { type: "bank", ...DEFAULT_BANK })
          }
          options={[
            { value: "none", label: "None", icon: <InfinityIcon />, showLabel: true },
            { value: "turn", label: "Per turn", icon: <Timer />, showLabel: true },
            { value: "bank", label: "Bank", icon: <Hourglass />, showLabel: true },
          ]}
        />
      </DialField>
      {value.type === "turn" ? (
        <Slider label="Seconds per turn" value={value.turnSeconds} min={10} max={300} step={5} unit="s" onChange={(v) => onChange({ type: "turn", turnSeconds: Math.round(v) })} />
      ) : null}
      {value.type === "bank" ? (
        <>
          <Slider
            label="Bank (minutes)"
            value={value.bankSeconds / 60}
            min={1}
            max={60}
            step={1}
            unit="min"
            onChange={(v) => onChange({ ...value, bankSeconds: Math.round(v) * 60 })}
          />
          <Slider
            label="Increment (s)"
            value={value.incrementSeconds}
            min={0}
            max={60}
            step={1}
            unit="s"
            onChange={(v) => onChange({ ...value, incrementSeconds: Math.round(v) })}
          />
        </>
      ) : null}
    </div>
  );
}
