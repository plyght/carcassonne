"use client";

import { Dices } from "lucide-react";

import type { Ruleset } from "@carcassonne/protocol";
import { randomSeedString } from "@carcassonne/game-client";
import { cn } from "@carcassonne/ui/lib/utils";

export const EDITION_TEXT: Record<1 | 2 | 3, string> = {
  3: "Each field scores 3 per completed city it touches, to its majority farmers.",
  2: "Like 3rd edition: 3 per completed city per field.",
  1: "Each completed city scores 4 once, to whoever has most farmers around it.",
};

function Row({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="max-w-md">
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange(v: boolean): void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn("relative h-6 w-11 rounded-full transition-colors", checked ? "bg-primary" : "bg-muted ring-1 ring-border")}
    >
      <span className={cn("absolute top-1 left-1 size-4 rounded-full bg-card shadow transition-transform", checked && "translate-x-5")} />
    </button>
  );
}

export function RulesForm({
  ruleset,
  onRuleset,
  seed,
  onSeed,
  disabled,
}: {
  ruleset: Ruleset;
  onRuleset(r: Ruleset): void;
  /** Omit to hide the seed row (online rooms: the server picks the seed). */
  seed?: string;
  onSeed?(s: string): void;
  disabled?: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="divide-y divide-border/60">
      <Row title="Field scoring" hint={EDITION_TEXT[ruleset.fieldEdition]}>
        <div className="inline-flex rounded-xl bg-muted p-0.5" role="radiogroup" aria-label="Field scoring edition">
          {([3, 2, 1] as const).map((e) => (
            <button
              key={e}
              type="button"
              role="radio"
              aria-checked={ruleset.fieldEdition === e}
              onClick={() => onRuleset({ ...ruleset, fieldEdition: e })}
              className={cn(
                "rounded-lg px-3 py-1 text-xs font-semibold",
                ruleset.fieldEdition === e ? "bg-card shadow-sm" : "text-muted-foreground",
              )}
            >
              {e === 3 ? "3rd" : e === 2 ? "2nd" : "1st"} ed.
            </button>
          ))}
        </div>
      </Row>
      <Row title="The River" hint="Start with the 12 river tiles, spring first and lake last.">
        <Switch label="The River" checked={ruleset.river} onChange={(v) => onRuleset({ ...ruleset, river: v })} />
      </Row>
      <Row title="The Abbot" hint="Each player gets an abbot for cloisters and gardens, and may recall it to score early.">
        <Switch label="The Abbot" checked={ruleset.abbot} onChange={(v) => onRuleset({ ...ruleset, abbot: v })} />
      </Row>
      {onSeed ? (
      <Row title="Seeded shuffle" hint="Same seed, same tile order: share it for rematches, puzzles and bug reports.">
        <div className="flex items-center gap-1.5">
          <input
            value={seed ?? ""}
            onChange={(e) => onSeed(e.target.value)}
            className="h-9 w-44 rounded-xl border border-input bg-background px-3 font-mono text-sm"
            aria-label="Seed"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={() => onSeed(randomSeedString())}
            className="grid size-9 place-items-center rounded-xl border border-input hover:bg-muted"
            aria-label="Random seed"
            title="Random seed"
          >
            <Dices className="size-4" />
          </button>
        </div>
      </Row>
      ) : null}
    </fieldset>
  );
}
