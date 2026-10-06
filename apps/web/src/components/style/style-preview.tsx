"use client";

import { useMemo } from "react";

import type { BoardTile, GameView } from "@carcassonne/protocol";
import { legalPlacementsOn, type TileCatalog } from "@carcassonne/game-client";
import { ClassicBoard, is3DStyle, type StylePack } from "@carcassonne/render-classic";

import { useCore } from "@/lib/core";

import { Board3D } from "../board3d/board-3d";

/** A small, legally connected sample board (built once). */
function buildSample(catalog: TileCatalog): BoardTile[] {
  const board = new Map<string, BoardTile>([["0,0", { x: 0, y: 0, rot: 0, tile: "D", figures: [] }]]);
  const order = ["F", "V", "B", "J", "M", "U", "W", "E", "K"];
  const on = (id: string, kind: string) => Math.max(0, catalog.get(id)?.features.findIndex((f) => f.kind === kind) ?? 0);
  const figs: Record<string, BoardTile["figures"]> = {
    F: [{ player: 0, feature: on("F", "city"), figure: "meeple" }],
    B: [{ player: 1, feature: on("B", "cloister"), figure: "abbot" }],
    W: [{ player: 2, feature: on("W", "road"), figure: "meeple" }],
    V: [{ player: 3, feature: on("V", "road"), figure: "meeple" }],
  };
  for (const id of order) {
    const legal = legalPlacementsOn(board, catalog, id);
    legal.sort((a, b) => Math.abs(a.x) + Math.abs(a.y) * 1.3 - (Math.abs(b.x) + Math.abs(b.y) * 1.3));
    const p = legal[0];
    if (!p) continue;
    board.set(`${p.x},${p.y}`, { ...p, tile: id, figures: figs[id] ?? [] });
  }
  return [...board.values()];
}

let SAMPLE: BoardTile[] | null = null;

const SAMPLE_PLAYERS = [{ color: "red" as const }, { color: "blue" as const }, { color: "yellow" as const }, { color: "green" as const }];

/**
 * Live preview of a style: the real renderer for 2D packs and (with `live3d`, which
 * lazy-loads three.js) for 3D packs; otherwise a swatch card.
 */
export function StylePreview({ style, className, live3d = false }: { style: StylePack; className?: string; live3d?: boolean }) {
  const core = useCore();
  const view = useMemo(() => (core ? ({ board: (SAMPLE ??= buildSample(core.catalog)) } as Pick<GameView, "board">) : null), [core]);
  if (style.status === "ready" && style.palette) {
    if (!core || !view) return <div className={className} style={{ background: style.palette.table }} />;
    return (
      <div className={className}>
        <ClassicBoard
          view={view}
          catalog={core.catalog}
          art={core.art}
          figures={core.figures}
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
  const ready3d = is3DStyle(style);
  if (ready3d && live3d && core && view) {
    return (
      <div className={`relative ${className ?? ""}`}>
        <Board3D
          geo={core.geo}
          styleId={style.id}
          camera="tabletop"
          tier="low"
          reducedMotion
          view={view as GameView}
          playerSlots={[0, 1, 2, 3]}
          controls={false}
          ariaLabel={`${style.name} preview`}
        />
      </div>
    );
  }
  return (
    <div className={className} aria-label={ready3d ? `${style.name}: 3D style` : `${style.name}: coming soon`}>
      <div
        className="relative grid h-full w-full place-items-center overflow-hidden"
        style={{ background: `radial-gradient(circle at 30% 20%, ${b}, ${a} 70%)` }}
      >
        <div className="absolute inset-0 opacity-40" style={{ background: `repeating-linear-gradient(45deg, transparent 0 14px, ${c}55 14px 16px)` }} />
        <div className="carc-board-chip relative">
          {ready3d ? "3D · plays in game" : `Coming ${style.ships}`}
        </div>
      </div>
    </div>
  );
}
