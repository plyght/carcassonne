"use client";

import { useMemo } from "react";

import type { BoardTile, GameView } from "@carcassonne/protocol";
import { legalPlacementsOn, tileCatalog } from "@carcassonne/game-client";
import { ClassicBoard, type StylePack } from "@carcassonne/render-classic";

/** A small, legally connected sample board (built once). */
function buildSample(): BoardTile[] {
  const board = new Map<string, BoardTile>([["0,0", { x: 0, y: 0, rot: 0, tile: "D", figures: [] }]]);
  const order = ["F", "V", "B", "J", "M", "U", "W", "E", "K"];
  const figs: Record<string, BoardTile["figures"]> = {
    F: [{ player: 0, feature: 0, figure: "meeple" }],
    B: [{ player: 1, feature: 0, figure: "abbot" }],
    W: [{ player: 2, feature: 3, figure: "meeple" }],
    V: [{ player: 3, feature: 0, figure: "meeple" }],
  };
  for (const id of order) {
    const legal = legalPlacementsOn(board, tileCatalog, id);
    legal.sort((a, b) => Math.abs(a.x) + Math.abs(a.y) * 1.3 - (Math.abs(b.x) + Math.abs(b.y) * 1.3));
    const p = legal[0];
    if (!p) continue;
    board.set(`${p.x},${p.y}`, { ...p, tile: id, figures: figs[id] ?? [] });
  }
  return [...board.values()];
}

let SAMPLE: BoardTile[] | null = null;

const SAMPLE_PLAYERS = [{ color: "red" as const }, { color: "blue" as const }, { color: "yellow" as const }, { color: "green" as const }];

/** Live preview of a style: real renderer for 2D packs, a swatch card for 3D ones. */
export function StylePreview({ style, className }: { style: StylePack; className?: string }) {
  const view = useMemo(() => ({ board: (SAMPLE ??= buildSample()) }) as Pick<GameView, "board">, []);
  if (style.status === "ready" && style.palette) {
    return (
      <div className={className}>
        <ClassicBoard
          view={view}
          catalog={tileCatalog}
          palette={style.palette}
          players={SAMPLE_PLAYERS}
          interactive={false}
          reducedMotion
          ariaLabel={`${style.name} preview`}
        />
      </div>
    );
  }
  const [a, b, c] = style.swatch;
  return (
    <div className={className} aria-label={`${style.name}: coming soon`}>
      <div
        className="relative grid h-full w-full place-items-center overflow-hidden"
        style={{ background: `radial-gradient(circle at 30% 20%, ${b}, ${a} 70%)` }}
      >
        <div className="absolute inset-0 opacity-40" style={{ background: `repeating-linear-gradient(45deg, transparent 0 14px, ${c}55 14px 16px)` }} />
        <div className="relative rounded-full bg-black/55 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-white">
          Coming {style.ships}
        </div>
      </div>
    </div>
  );
}
