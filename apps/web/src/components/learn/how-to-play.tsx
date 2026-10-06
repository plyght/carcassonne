"use client";

// "How to play": the whole game on one sheet, in plain sentences, each rule next to
// a small real board drawn with the game's own tiles. Opened from the HUD, the setup
// page and the tutorial.

import { useEffect, useRef, type ReactNode } from "react";

import Link from "next/link";
import { X } from "lucide-react";


import { SupplyChip } from "../game/hud-parts";
import { MiniBoard, type MiniTile } from "./mini-board";

const ROAD: MiniTile[] = [
  { tile: "D", x: 0, y: 0, rot: 0 },
  { tile: "A", x: 1, y: 0, rot: 1 },
  { tile: "U", x: -1, y: 0, rot: 1, figure: { feature: 0, color: "blue" } },
  { tile: "W", x: -2, y: 0 },
];
const CITY: MiniTile[] = [
  { tile: "D", x: 0, y: 0, rot: 0 },
  { tile: "U", x: -1, y: 0, rot: 1 },
  { tile: "E", x: -1, y: -1, rot: 1 },
  { tile: "M", x: 0, y: -1, figure: { feature: 0, color: "blue" } },
];
const CLOISTER: MiniTile[] = [
  { tile: "B", x: 0, y: 0, figure: { feature: 0, color: "blue" } },
  { tile: "E", x: 0, y: -1, rot: 0 },
  { tile: "E", x: -1, y: -1, rot: 0 },
  { tile: "E", x: 1, y: -1, rot: 0 },
  { tile: "E", x: -1, y: 0, rot: 3 },
  { tile: "E", x: 1, y: 0, rot: 1 },
  { tile: "E", x: -1, y: 1, rot: 2 },
  { tile: "E", x: 1, y: 1, rot: 2 },
  { tile: "E", x: 0, y: 1, rot: 2 },
];
const FIELD: MiniTile[] = [
  { tile: "D", x: 0, y: 0, rot: 0 },
  { tile: "E", x: 0, y: -1, rot: 2 },
  { tile: "U", x: 1, y: 0, rot: 1, figure: { feature: 1, color: "blue" } },
];
const MATCH: MiniTile[] = [
  { tile: "D", x: 0, y: 0, rot: 0 },
  { tile: "V", x: 1, y: 0, focus: true },
];
const RIVER: MiniTile[] = [
  { tile: "R1", x: 0, y: 0, prefer: 0 },
  { tile: "R4", x: 1, y: 0 },
  { tile: "R11", x: 2, y: 0 },
  { tile: "R12", x: 3, y: 0 },
];
const ABBOT: MiniTile[] = [
  { tile: "Eg", x: 0, y: 0, rot: 0, figure: { feature: 2, color: "blue", kind: "abbot" } },
  { tile: "B", x: 1, y: 0, figure: { feature: 0, color: "red", kind: "abbot" } },
];

function Rule({ title, children, board, label, cell }: { title: string; children: ReactNode; board: MiniTile[]; label: string; cell?: number }) {
  return (
    <section className="carc-rule">
      <div className="carc-rule-text">
        <h3 className="carc-rule-title">{title}</h3>
        {children}
      </div>
      <figure className="carc-rule-figure">
        <MiniBoard tiles={board} label={label} cell={cell} />
      </figure>
    </section>
  );
}

export function RulesSheet({ compact }: { compact?: boolean }) {
  return (
    <div className="carc-rules" data-compact={compact || undefined}>
      <section className="carc-rule carc-rule-turn">
        <div className="carc-rule-text">
          <h3 className="carc-rule-title">Every turn has three steps</h3>
          <ol className="carc-steps-list">
            <li>
              <strong>Place your tile.</strong> You draw one tile and add it to the map so that it touches what is already there.
            </li>
            <li>
              <strong>Claim something, if you like.</strong> Put one of your meeples on a road, city, cloister or field of the tile you just placed, as long as nobody has claimed it yet.
            </li>
            <li>
              <strong>Score.</strong> When a road, city or cloister is finished, whoever has the most meeples on it scores, and those meeples come back to their owners.
            </li>
          </ol>
        </div>
      </section>

      <Rule title="Edges must match" board={MATCH} cell={68} label="A bend placed next to the start tile: road meets road, field meets field.">
        <p>The new tile must touch the map, and every edge it touches must match: road to road, city to city, field to field. Glowing spots on the board show where your tile fits. Rotate it with R or the dial.</p>
      </Rule>

      <h3 className="carc-rules-sub">The four things you can claim</h3>

      <Rule title="Roads: thieves" board={ROAD} label="A road from a junction to a cloister, with a blue thief on it.">
        <p>A road is finished when both ends stop at a village, a cloister, a city or a crossroads, and it scores 1 point per tile, so this one is worth 4 points.</p>
      </Rule>
      <Rule title="Cities: knights" board={CITY} cell={72} label="A three-tile city closed by its walls, with a blue knight in it.">
        <p>A city is finished when its walls close all the way round, and it scores 2 points per tile and 2 per blue shield, so this one with 3 tiles and 1 shield is worth 8 points.</p>
      </Rule>
      <Rule title="Cloisters: monks" board={CLOISTER} label="A cloister with all eight neighbouring spaces filled, with a blue monk." cell={40}>
        <p>A cloister is finished when all 8 spaces around it hold tiles, and then it scores 9 points.</p>
      </Rule>
      <Rule title="Fields: farmers" board={FIELD} cell={68} label="A blue farmer lying in the field above the road, next to a finished city.">
        <p>Farmers lie down and stay until the game ends, and then each field scores 3 points for every finished city it touches, for whoever has the most farmers in it.</p>
      </Rule>

      <section className="carc-rule carc-rule-meeples">
        <div className="carc-rule-text">
          <h3 className="carc-rule-title">Meeples</h3>
          <p>You have seven meeples. Each one you place stays until its road, city or cloister is finished and then comes back to you, but farmers never come back, so it pays to place them late. If two features join, the player with more meeples on the joined feature takes all the points; a tie means everyone tied scores.</p>
        </div>
        <figure className="carc-rule-figure">
          <SupplyChip color="blue" label="7 meeples" />
        </figure>
      </section>

      <h3 className="carc-rules-sub">Optional rules</h3>
      <Rule title="The River" board={RIVER} label="River tiles from the spring to the lake." cell={48}>
        <p>The game starts with 12 river tiles, laid one after another from the spring to the lake. Nobody can claim the river, but the roads and cities beside it can be claimed as usual.</p>
      </Rule>
      <Rule title="The Abbot" board={ABBOT} label="An abbot in a garden and another in a cloister.">
        <p>Each player gets one extra figure, the abbot, which can only go on a cloister or a garden (a small walled orchard). On a later turn, instead of placing a meeple, you can bring the abbot home and score its cloister or garden as it stands.</p>
      </Rule>

      <section className="carc-rule">
        <div className="carc-rule-text">
          <h3 className="carc-rule-title">The end</h3>
          <p>The game ends when the last tile is placed. Unfinished roads and cities then score 1 point per tile (and per shield), unfinished cloisters score 1 plus 1 per neighbour, farmers score their fields, and whoever has the most points wins.</p>
        </div>
      </section>
    </div>
  );
}

/** The rules sheet as a dialog over the game. */
export function HowToPlay({ open, onClose }: { open: boolean; onClose(): void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="carc-modal" role="presentation" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="carc-sheet carc-rules-dialog" role="dialog" aria-modal="true" aria-labelledby="how-to-play-title" data-testid="how-to-play">
        <div className="carc-rules-head">
          <div>
            <h2 id="how-to-play-title" className="carc-heading">
              How to play
            </h2>
            <p className="carc-sub">This is the whole game in about three minutes: you build a map of southern France one tile at a time, and you score by claiming what you build.</p>
          </div>
          <button ref={closeRef} type="button" className="carc-icon-btn" onClick={onClose} aria-label="Close" title="Close (Esc)">
            <X />
          </button>
        </div>
        <RulesSheet />
        <div className="carc-rules-foot">
          <Link href="/tutorial" className="carc-btn" data-variant="ghost">
            Play the tutorial
          </Link>
          <button type="button" className="carc-btn" data-variant="primary" onClick={onClose}>
            Back to the game
          </button>
        </div>
      </div>
    </div>
  );
}
