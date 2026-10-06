"use client";

// House rules as DialKit controls, each explained in plain words for someone who has
// never played: The River and The Abbot (toggles), how farmers score (select), and,
// under "Advanced", the seeded shuffle. The recommended setting is marked. Used by the
// local setup and online room creation.

import { useState } from "react";

import { SelectControl, Toggle } from "dialkit";
import { ChevronDown, Dices } from "lucide-react";

import { DEFAULT_RULESET, type Ruleset } from "@carcassonne/protocol";
import { randomSeedString } from "@carcassonne/game-client";

import { DialField, DialIconButton } from "@/components/dial/primitives";

export const EDITION_TEXT: Record<1 | 2 | 3, string> = {
  3: "At the end, each field earns 3 points for every finished city it touches, for whoever has the most farmers in it.",
  2: "Scores like the 3rd edition: 3 points per finished city a field touches.",
  1: "At the end, each finished city earns 4 points once, for whoever has the most farmers in the fields around it.",
};

const EDITIONS = [
  { value: "3", label: "3rd edition" },
  { value: "2", label: "2nd edition" },
  { value: "1", label: "1st edition" },
];

/** "Recommended" (or "Recommended: on") next to a rule's explanation. */
export function Recommended({ is, children }: { is: boolean; children?: string }) {
  return (
    <span className="carc-recommended" data-on={is || undefined}>
      {is ? "Recommended" : `Recommended: ${children}`}
    </span>
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
  const [advanced, setAdvanced] = useState(false);
  const rec = DEFAULT_RULESET;
  return (
    <fieldset disabled={disabled} className="carc-dial-stack" data-testid="rules-form" style={{ border: 0, margin: 0, padding: 0, minWidth: 0, gap: "var(--sp-4)" }}>
      <DialField
        hint={
          <>
            <Recommended is={ruleset.river === rec.river}>{rec.river ? "on" : "off"}</Recommended> The game opens with 12 river tiles laid end to end, from the spring to the lake. It spreads the map out nicely, and the river itself is scenery that nobody can claim.
          </>
        }
      >
        <Toggle label="The River" checked={ruleset.river} onChange={(v) => onRuleset({ ...ruleset, river: v })} />
      </DialField>
      <DialField
        hint={
          <>
            <Recommended is={ruleset.abbot === rec.abbot}>{rec.abbot ? "on" : "off"}</Recommended> Everyone gets one extra figure, the abbot, for cloisters and gardens (small walled orchards). You can bring it home early to score what it’s sitting on.
          </>
        }
      >
        <Toggle label="The Abbot" checked={ruleset.abbot} onChange={(v) => onRuleset({ ...ruleset, abbot: v })} />
      </DialField>
      <DialField
        hint={
          <>
            <Recommended is={ruleset.fieldEdition === rec.fieldEdition}>3rd edition</Recommended> How farmers score. {EDITION_TEXT[ruleset.fieldEdition]}
          </>
        }
      >
        <SelectControl
          label="Field scoring"
          value={String(ruleset.fieldEdition)}
          options={EDITIONS}
          onChange={(v) => onRuleset({ ...ruleset, fieldEdition: Number(v) as 1 | 2 | 3 })}
        />
      </DialField>
      {onSeed ? (
        <div className="carc-advanced" data-open={advanced || undefined}>
          <button type="button" className="carc-disclosure" aria-expanded={advanced} onClick={() => setAdvanced((o) => !o)} data-testid="advanced-toggle">
            <span>Advanced</span>
            <span className="carc-disclosure-hint">The seed that decides the tile order</span>
            <ChevronDown className="carc-disclosure-chevron" aria-hidden />
          </button>
          {advanced ? (
            <DialField hint="The seed decides the order of the tiles, and a game with the same seed deals the same tiles, so you can share it for a rematch, a puzzle or a bug report. Leave it as it is for a random game.">
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
        </div>
      ) : null}
    </fieldset>
  );
}
