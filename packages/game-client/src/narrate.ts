// Plain-language narration of engine events, for people who have never played:
// "Brother Odo placed a city tile and claimed the city with a knight.",
// "Your city is complete: 3 tiles + 1 shield, 2 points each = 8 points. Your knight comes back."
// Pure functions over the catalog and player names; no UI.

import type { EngineEvent, FeatureKind, FieldEdition, TileId } from "@carcassonne/protocol";

import type { PlayerMeta } from "./client";
import type { TileCatalog, TileDef } from "./tiles";

/** The figure's name on each feature (the box's own words). */
export const FIGURE_ROLE: Record<FeatureKind, string> = {
  road: "thief",
  city: "knight",
  cloister: "monk",
  field: "farmer",
  garden: "abbot",
  river: "",
};

export const FEATURE_NAME: Record<FeatureKind, string> = {
  road: "road",
  city: "city",
  cloister: "cloister",
  field: "field",
  garden: "garden",
  river: "river",
};

/** How each feature scores, in one or two plain sentences. */
export function featureRule(kind: FeatureKind, edition: FieldEdition = 3): string {
  switch (kind) {
    case "road":
      return "A road is finished when both ends stop at a village, a cloister, a city or a crossroads. It scores 1 point per tile, finished or not.";
    case "city":
      return "A city is finished when its walls close all the way round. It scores 2 points per tile and per shield; unfinished at the end, 1 each.";
    case "cloister":
      return "A cloister is finished when all 8 spaces around it hold tiles: 9 points. At the end it scores 1 plus 1 per neighbouring tile.";
    case "garden":
      return "Only the abbot can claim a garden. Like a cloister: 9 points once surrounded, otherwise 1 plus 1 per neighbour at the end.";
    case "field":
      return edition === 1
        ? "Farmers stay until the game ends. Each finished city scores 4 points for whoever has the most farmers in the fields around it."
        : "Farmers stay until the game ends. Then each field scores 3 points per finished city it touches, for whoever has the most farmers in it.";
    case "river":
      return "The river is scenery: it can't be claimed.";
  }
}

export function playerName(players: PlayerMeta[], i: number | null | undefined): string {
  if (i === null || i === undefined) return "Spectator";
  return players[i]?.name ?? `Player ${i + 1}`;
}

/** "Your" for the player called "You", else "Brother Odo's". */
export function possessive(name: string): string {
  if (name === "You") return "Your";
  return name.endsWith("s") ? `${name}’` : `${name}’s`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "a city tile", "a road tile", "a cloister tile with a road". */
export function describeTile(def: TileDef | undefined): string {
  if (!def) return "a tile";
  const kinds = new Set(def.features.map((f) => f.kind));
  const main = kinds.has("cloister") ? "cloister" : kinds.has("garden") ? "garden" : kinds.has("city") ? "city" : kinds.has("river") ? "river" : kinds.has("road") ? "road" : "field";
  const extra = main !== "road" && kinds.has("road") ? " with a road" : "";
  return `a ${main} tile${extra}`;
}

type Scored = Extract<EngineEvent, { type: "featureScored" }>;

/**
 * Why a feature scored, for whom and what came back:
 * "Your city is complete: 3 tiles + 1 shield, 2 points each = 8 points. Your knight comes back."
 */
export function explainScore(e: Scored, players: PlayerMeta[], edition: FieldEdition = 3): string | null {
  if (!e.winners.length || !e.points) return null;
  const names = e.winners.map((w) => playerName(players, w));
  const shared = names.length > 1;
  const own = (what: string) => (shared ? `The ${what}` : `${possessive(names[0]!)} ${what}`);
  const tiles = e.cells.length;
  const p = e.points;
  let why: string;
  switch (e.kind) {
    case "road":
      why = e.final
        ? `${own("unfinished road")} scores at the end: ${plural(tiles, "tile")} = ${plural(p, "point")}.`
        : `${own("road")} is complete: ${plural(tiles, "tile")} = ${plural(p, "point")}.`;
      break;
    case "city": {
      if (e.final) {
        const shields = Math.max(0, p - tiles);
        why = `${own("unfinished city")} scores at the end: ${plural(tiles, "tile")}${shields ? ` + ${plural(shields, "shield")}` : ""}, 1 point each = ${plural(p, "point")}.`;
      } else {
        const shields = Math.max(0, Math.round((p - 2 * tiles) / 2));
        const exact = 2 * tiles + 2 * shields === p;
        why = exact
          ? `${own("city")} is complete: ${plural(tiles, "tile")}${shields ? ` + ${plural(shields, "shield")}` : ""}, 2 points each = ${plural(p, "point")}.`
          : `${own("city")} is complete: ${plural(tiles, "tile")} = ${plural(p, "point")}.`;
      }
      break;
    }
    case "cloister":
    case "garden":
      why = e.final
        ? `${own(e.kind)} has ${plural(p - 1, "neighbour")} at the end: 1 + ${p - 1} = ${plural(p, "point")}.`
        : `${own(e.kind)} is surrounded by 8 tiles: ${plural(p, "point")}.`;
      break;
    case "field": {
      const per = edition === 1 ? 4 : 3;
      const cities = Math.round(p / per);
      why = `${own("farmers’ field")} touches ${plural(cities, "finished city", "finished cities")}: ${cities} × ${per} = ${plural(p, "point")}.`;
      break;
    }
    default:
      why = `${names.join(" and ")} scored ${plural(p, "point")}.`;
  }
  if (shared) why += ` ${names.join(" and ")} tied for the most ${FIGURE_ROLE[e.kind] || "meeple"}s, so each scores it.`;
  const back = e.final ? "" : returnedText(e, players);
  return back ? `${why} ${back}` : why;
}

function returnedText(e: Scored, players: PlayerMeta[]): string {
  const by = new Map<number, { meeple: number; abbot: number }>();
  for (const f of e.returned) {
    const c = by.get(f.player) ?? { meeple: 0, abbot: 0 };
    c[f.figure]++;
    by.set(f.player, c);
  }
  const role = FIGURE_ROLE[e.kind] || "meeple";
  return [...by.entries()]
    .map(([pl, c]) => {
      const who = possessive(playerName(players, pl));
      const parts = [c.meeple ? (c.meeple === 1 ? role : `${c.meeple} ${role}s`) : "", c.abbot ? "abbot" : ""].filter(Boolean).join(" and ");
      const many = c.meeple + c.abbot > 1;
      return `${who} ${parts} ${many ? "come" : "comes"} back.`;
    })
    .join(" ");
}

export interface NarratedLine {
  text: string;
  /** Seat the line is about (for a colour swatch). */
  player: number | null;
  /** A scoring line (worth celebrating). */
  score?: boolean;
}

/** One move's events as a few readable sentences. */
export function narrateBatch(events: EngineEvent[], players: PlayerMeta[], catalog: TileCatalog, edition: FieldEdition = 3): NarratedLine[] {
  const out: NarratedLine[] = [];
  const placed = events.find((e): e is Extract<EngineEvent, { type: "tilePlaced" }> => e.type === "tilePlaced");
  const figure = events.find((e): e is Extract<EngineEvent, { type: "figurePlaced" }> => e.type === "figurePlaced");
  const recalled = events.find((e): e is Extract<EngineEvent, { type: "abbotRecalled" }> => e.type === "abbotRecalled");
  if (placed) {
    const def = catalog.get(placed.tile);
    const name = playerName(players, placed.player);
    let text = `${name} placed ${describeTile(def)}`;
    if (figure && figure.player === placed.player) {
      const kind = def?.features[figure.feature]?.kind ?? "field";
      text +=
        figure.figure === "abbot"
          ? ` and put the abbot in the ${FEATURE_NAME[kind]}`
          : ` and claimed the ${FEATURE_NAME[kind]} with a ${FIGURE_ROLE[kind] || "meeple"}`;
    }
    if (recalled) text += ` and brought the abbot home for ${plural(recalled.points, "point")}`;
    out.push({ text: `${text}.`, player: placed.player });
  }
  for (const e of events) {
    if (e.type === "tileDiscarded") out.push({ text: `Tile ${e.tile} fit nowhere, so it was set aside.`, player: null });
    if (e.type === "featureScored") {
      const t = explainScore(e, players, edition);
      if (t) out.push({ text: t, player: e.winners.length === 1 ? e.winners[0]! : null, score: true });
    }
    if (e.type === "gameEnded") out.push({ text: "The last tile is down: final scoring is done.", player: null });
  }
  return out;
}

/** The tile kind a player sees in hand ("a city tile"), for prompts. */
export function tileLabel(catalog: TileCatalog, id: TileId | null): string {
  return id ? describeTile(catalog.get(id)) : "a tile";
}
