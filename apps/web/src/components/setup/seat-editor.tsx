"use client";

import { Bot, User } from "lucide-react";

import type { AiTier } from "@carcassonne/protocol";
import type { PlayerColorId, PlayerMeta } from "@carcassonne/game-client";
import { FigureIcon, PLAYER_COLOR_ORDER, PLAYER_COLORS } from "@carcassonne/render-classic";
import { cn } from "@carcassonne/ui/lib/utils";

export const TIERS: { id: AiTier; label: string; hint: string }[] = [
  { id: "easy", label: "Easy", hint: "Greedy, loves placing meeples" },
  { id: "medium", label: "Medium", hint: "Weighs completion and meeple economy" },
  { id: "hard", label: "Hard", hint: "Searches the remaining tiles" },
  { id: "expert", label: "Expert", hint: "Deeper search, models opponents" },
];

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
    // Colours stay unique: swap with whoever had it.
    if (patch.color) {
      const other = seats.findIndex((s, k) => k !== i && s.color === patch.color);
      if (other >= 0) next[other] = { ...next[other]!, color: seats[i]!.color };
    }
    onChange(next);
  };
  return (
    <ol className="grid gap-2">
      {seats.map((s, i) => {
        const app = PLAYER_COLORS[s.color];
        return (
          <li key={i} className="flex flex-wrap items-center gap-3 rounded-2xl border border-border/80 bg-background/60 p-3">
            <span className="grid size-10 place-items-center rounded-xl" style={{ background: `${app.fill}22` }}>
              <FigureIcon fill={app.fill} ink={app.ink} marker={app.marker} size={30} title={app.label} />
            </span>
            <input
              value={s.name}
              onChange={(e) => set(i, { name: e.target.value.slice(0, 20) })}
              className="h-9 min-w-0 flex-1 rounded-xl border border-input bg-background px-3 text-sm font-medium"
              aria-label={`Seat ${i + 1} name`}
            />
            <div className="flex gap-1" role="radiogroup" aria-label={`Seat ${i + 1} colour`}>
              {PLAYER_COLOR_ORDER.slice(0, 5).map((c: PlayerColorId) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={s.color === c}
                  aria-label={PLAYER_COLORS[c].label}
                  onClick={() => set(i, { color: c })}
                  className={cn(
                    "grid size-7 place-items-center rounded-full ring-offset-2 ring-offset-background transition",
                    s.color === c ? "ring-2 ring-foreground" : "hover:scale-110",
                  )}
                  style={{ background: PLAYER_COLORS[c].fill }}
                />
              ))}
            </div>
            {allowBots ? (
              <div className="flex items-center gap-1.5">
                <div className="inline-flex rounded-xl bg-muted p-0.5">
                  <button
                    type="button"
                    onClick={() => set(i, { kind: "human", name: s.kind === "bot" ? `Player ${i + 1}` : s.name })}
                    className={cn("flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium", s.kind === "human" ? "bg-card shadow-sm" : "text-muted-foreground")}
                    aria-pressed={s.kind === "human"}
                  >
                    <User className="size-3.5" /> Human
                  </button>
                  <button
                    type="button"
                    onClick={() => set(i, { kind: "bot", tier: s.tier ?? "medium", name: s.kind === "bot" ? s.name : botName(i) })}
                    className={cn("flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium", s.kind === "bot" ? "bg-card shadow-sm" : "text-muted-foreground")}
                    aria-pressed={s.kind === "bot"}
                  >
                    <Bot className="size-3.5" /> Bot
                  </button>
                </div>
                {s.kind === "bot" ? (
                  <select
                    value={s.tier ?? "medium"}
                    onChange={(e) => set(i, { tier: e.target.value as AiTier })}
                    className="h-8 rounded-lg border border-input bg-background px-2 text-xs"
                    aria-label={`Seat ${i + 1} bot level`}
                  >
                    {TIERS.map((t) => (
                      <option key={t.id} value={t.id} title={t.hint}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
