"use client";

// House rules as DialKit controls: field scoring edition (select), The River and The
// Abbot (toggles), each with a one-line explanation, plus the seeded shuffle (text +
// re-roll). Used by the local setup and online room creation.

import { SelectControl, Toggle } from "dialkit";
import { Dices } from "lucide-react";

import type { Ruleset } from "@carcassonne/protocol";
import { randomSeedString } from "@carcassonne/game-client";

import { DialField, DialIconButton } from "@/components/dial/primitives";

export const EDITION_TEXT: Record<1 | 2 | 3, string> = {
  3: "Each field scores 3 per completed city it touches, to its majority farmers.",
  2: "Like 3rd edition: 3 per completed city per field.",
  1: "Each completed city scores 4 once, to whoever has most farmers around it.",
};

const EDITIONS = [
  { value: "3", label: "3rd edition" },
  { value: "2", label: "2nd edition" },
  { value: "1", label: "1st edition" },
];

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
    <fieldset disabled={disabled} className="carc-dial-stack" data-testid="rules-form" style={{ border: 0, margin: 0, padding: 0, minWidth: 0, gap: "var(--sp-3)" }}>
      <DialField hint={EDITION_TEXT[ruleset.fieldEdition]}>
        <SelectControl
          label="Field scoring"
          value={String(ruleset.fieldEdition)}
          options={EDITIONS}
          onChange={(v) => onRuleset({ ...ruleset, fieldEdition: Number(v) as 1 | 2 | 3 })}
        />
      </DialField>
      <DialField hint="Start with the 12 river tiles, spring first and lake last.">
        <Toggle label="The River" checked={ruleset.river} onChange={(v) => onRuleset({ ...ruleset, river: v })} />
      </DialField>
      <DialField hint="Each player gets an abbot for cloisters and gardens, and may recall it to score early.">
        <Toggle label="The Abbot" checked={ruleset.abbot} onChange={(v) => onRuleset({ ...ruleset, abbot: v })} />
      </DialField>
      {onSeed ? (
        <DialField hint="Same seed, same tile order: share it for rematches, puzzles and bug reports.">
          <div className="carc-seed" data-testid="seed-row">
            <span className="carc-seed-label">Seed</span>
            <input
              className="carc-seed-input"
              value={seed ?? ""}
              placeholder="random"
              spellCheck={false}
              autoComplete="off"
              aria-label="Seed"
              onChange={(e) => onSeed(e.target.value.replace(/\s+/g, "-").slice(0, 40))}
            />
            <DialIconButton label="Re-roll seed" onClick={() => onSeed(randomSeedString())} data-testid="reroll-seed">
              <Dices />
            </DialIconButton>
          </div>
        </DialField>
      ) : null}
    </fieldset>
  );
}
