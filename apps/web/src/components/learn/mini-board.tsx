"use client";

// A few real tiles laid out as a small illustration (rules sheet, coach marks, the
// tutorial): the engine's own tile art, with solid meeples on top. Rotations may be
// left out: the first rotation that fits the tiles laid before it is used, so a
// diagram can never show edges that don't match.

import { useMemo } from "react";

import type { BoardTile, TileId } from "@carcassonne/protocol";
import { boardFromTiles, fits, type PlayerColorId, type TileCatalog } from "@carcassonne/game-client";
import { CLASSIC_PALETTE, FigureIcon, PLAYER_COLORS, proceduralArt, rotatePoint, TileThumb } from "@carcassonne/render-classic";
import { cn } from "@carcassonne/ui/lib/utils";

import { useCore } from "@/lib/core";

export interface MiniTile {
  tile: TileId;
  x: number;
  y: number;
  rot?: 0 | 1 | 2 | 3;
  /** Prefer this rotation when several fit. */
  prefer?: 0 | 1 | 2 | 3;
  figure?: { feature: number; color: PlayerColorId; kind?: "meeple" | "abbot" };
  /** Draw this tile lifted and outlined: "the tile you place". */
  focus?: boolean;
}

function layout(tiles: MiniTile[], catalog: TileCatalog | null): (MiniTile & { rot: 0 | 1 | 2 | 3 })[] {
  const placed: BoardTile[] = [];
  return tiles.map((t) => {
    let rot = t.rot;
    if (rot === undefined) {
      const def = catalog?.get(t.tile);
      const board = boardFromTiles(placed);
      const order = [t.prefer ?? 0, 0, 1, 2, 3] as (0 | 1 | 2 | 3)[];
      rot = (def && placed.length ? order.find((r) => fits(board, catalog!, def, t.x, t.y, r)) : (t.prefer ?? 0)) ?? 0;
    }
    placed.push({ tile: t.tile, x: t.x, y: t.y, rot, figures: [] });
    return { ...t, rot };
  });
}

export function MiniBoard({ tiles, cell = 56, className, label }: { tiles: MiniTile[]; cell?: number; className?: string; label: string }) {
  const core = useCore();
  const catalog = core?.catalog ?? null;
  const art = core?.art ?? proceduralArt;
  const laid = useMemo(() => layout(tiles, catalog), [tiles, catalog]);
  if (!catalog) return <div className={cn("carc-mini", className)} style={{ height: cell * 2 }} aria-busy="true" />;
  const xs = laid.map((t) => t.x);
  const ys = laid.map((t) => t.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const w = (Math.max(...xs) - x0 + 1) * cell;
  const h = (Math.max(...ys) - y0 + 1) * cell;
  return (
    <div className={cn("carc-mini", className)} role="img" aria-label={label} style={{ width: w, height: h }}>
      {laid.map((t) => {
        const def = catalog.get(t.tile);
        if (!def) return null;
        const left = (t.x - x0) * cell;
        const top = (t.y - y0) * cell;
        const f = t.figure;
        let fig: { x: number; y: number } | null = null;
        if (f) {
          const anchor = art.get(def).features[f.feature]?.anchor ?? [50, 50];
          const [ax, ay] = rotatePoint(anchor, t.rot);
          fig = { x: left + (ax / 100) * cell, y: top + (ay / 100) * cell };
        }
        const app = f ? PLAYER_COLORS[f.color] : null;
        const kind = f ? def.features[f.feature]?.kind : undefined;
        const size = Math.round(cell * 0.46);
        return (
          <div key={`${t.x},${t.y}`} className="carc-mini-cell" data-focus={t.focus || undefined} style={{ left, top, width: cell, height: cell }}>
            <TileThumb def={def} art={art} palette={CLASSIC_PALETTE} rot={t.rot} size={cell} title={`Tile ${def.id}`} />
            {fig && app ? (
              <span className="carc-mini-figure" style={{ left: fig.x - left - size / 2, top: fig.y - top - size / 2 - 2 }}>
                <FigureIcon kind={f!.kind ?? "meeple"} fill={app.fill} ink={app.ink} outline="#2b2117" marker={app.marker} size={size} lying={kind === "field"} />
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
