import { memo } from "react";

import type { TileDef } from "@carcassonne/game-client";

import type { BoardPalette } from "./palette";
import { rotatePoint, TILE, type Pt, type TileArt, type TileArtSource } from "./tile-art";

export function hatchId(palette: BoardPalette) {
  return `cc-hatch-${palette.id}`;
}

/** Shared <defs> (patterns) a board or thumbnail needs. */
export function PaletteDefs({ palette }: { palette: BoardPalette }) {
  return (
    <defs>
      {palette.city.hatch ? (
        <pattern id={hatchId(palette)} width={5} height={5} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1={0} y1={0} x2={0} y2={5} stroke={palette.city.hatch} strokeWidth={1.2} />
        </pattern>
      ) : null}
    </defs>
  );
}

function CloisterIcon({ at, p }: { at: Pt; p: BoardPalette }) {
  const [x, y] = at;
  const b = p.building;
  return (
    <g transform={`translate(${x - 14} ${y - 18})`} pointerEvents="none">
      <path d="M3 14h22v18H3Z" fill={b.body} stroke={b.outline} strokeWidth={1.4} />
      <path d="M1 15L14 4L27 15Z" fill={b.roof} stroke={b.outline} strokeWidth={1.4} strokeLinejoin="round" />
      <path d="M17 6V-2M13.5 1H20.5" stroke={b.outline} strokeWidth={1.6} strokeLinecap="round" fill="none" />
      <path d="M11 32V25a3 3 0 0 1 6 0v7" fill={b.outline} opacity={0.75} />
      <circle cx={14} cy={19} r={1.8} fill={b.outline} opacity={0.6} />
    </g>
  );
}

function VillageIcon({ at, p }: { at: Pt; p: BoardPalette }) {
  const [x, y] = at;
  const b = p.building;
  return (
    <g transform={`translate(${x - 8} ${y - 8})`} pointerEvents="none">
      <path d="M2 8h12v8H2Z" fill={b.body} stroke={b.outline} strokeWidth={1.2} />
      <path d="M0.5 9L8 2.5L15.5 9Z" fill={b.roof} stroke={b.outline} strokeWidth={1.2} strokeLinejoin="round" />
    </g>
  );
}

function Pennant({ at, p }: { at: Pt; p: BoardPalette }) {
  const [x, y] = at;
  return (
    <g transform={`translate(${x} ${y})`} pointerEvents="none">
      <path d="M-5.5 -6.5H5.5V0C5.5 4.2 0 7 0 7C0 7 -5.5 4.2 -5.5 0Z" fill={p.pennant.fill} stroke={p.pennant.stroke} strokeWidth={1.3} />
      <path d="M0 -4V3.5M-3 -0.5H3" stroke={p.pennant.mark} strokeWidth={1.3} strokeLinecap="round" />
    </g>
  );
}

export interface TileSvgProps {
  def: TileDef;
  art: TileArtSource;
  palette: BoardPalette;
  rot: number;
  /** Board cell; omitted for thumbnails. */
  x?: number;
  y?: number;
  /** Emit data-node attributes for feature hover hit-testing. */
  hitTest?: boolean;
  className?: string;
  opacity?: number;
}

function TileSvgImpl({ def, art: source, palette: p, rot, x = 0, y = 0, hitTest, className, opacity }: TileSvgProps) {
  const art: TileArt = source.get(def);
  const node = (i: number) => (hitTest ? { "data-node": `${x},${y},${i}` } : {});
  const roads = art.features.filter((f) => f.line && f.kind === "road");
  const rivers = art.features.filter((f) => f.line && f.kind === "river");
  const cities = art.features.filter((f) => f.kind === "city" && f.area);
  const fields = art.features.filter((f) => f.kind === "field" && f.area);
  const cloisters = art.features.filter((f) => f.kind === "cloister" || f.kind === "garden");
  const up = (pt: Pt) => rotatePoint(pt, rot);

  return (
    <g transform={`translate(${x * TILE} ${y * TILE})`} opacity={opacity}>
    <g className={className}>
      <g transform={rot ? `rotate(${rot * 90} 50 50)` : undefined}>
        <rect width={TILE} height={TILE} fill={p.tile.field} />
        {fields.map((f) => (
          <path
            key={`f${f.index}`}
            d={f.area}
            fill={p.tile.field}
            pointerEvents={hitTest ? "all" : "none"}
            {...node(f.index)}
          />
        ))}
        {rivers.map((f) => (
          <path key={`w${f.index}`} d={f.line} stroke={p.river.fill} strokeWidth={12} fill="none" strokeLinecap="round" {...node(f.index)} />
        ))}
        {roads.map((f) => (
          <g key={`r${f.index}`}>
            <path d={f.line} stroke={p.road.casing} strokeWidth={p.road.casingWidth} fill="none" strokeLinecap="butt" pointerEvents="none" />
            <path
              d={f.line}
              stroke={p.road.fill}
              strokeWidth={p.road.fillWidth}
              strokeDasharray={p.road.dash}
              fill="none"
              strokeLinecap="butt"
              pointerEvents="none"
            />
            {hitTest ? <path d={f.line} stroke="transparent" strokeWidth={14} fill="none" pointerEvents="stroke" {...node(f.index)} /> : null}
          </g>
        ))}
        {cities.map((f) => (
          <g key={`c${f.index}`}>
            <path d={f.area} fill={p.city.fill} pointerEvents={hitTest ? "all" : "none"} {...node(f.index)} />
            {p.city.hatch ? <path d={f.area} fill={`url(#${hatchId(p)})`} pointerEvents="none" /> : null}
            {f.walls ? (
              <>
                <path d={f.walls} stroke={p.city.wall} strokeWidth={p.city.wallWidth} fill="none" strokeLinecap="round" pointerEvents="none" />
                {p.city.crenel !== p.city.wall ? (
                  <path
                    d={f.walls}
                    stroke={p.city.crenel}
                    strokeWidth={p.city.wallWidth * 0.55}
                    strokeDasharray="2.2 2.2"
                    fill="none"
                    pointerEvents="none"
                  />
                ) : null}
              </>
            ) : null}
          </g>
        ))}
        {hitTest
          ? cloisters.map((f) => <path key={`k${f.index}`} d={f.area} fill="transparent" pointerEvents="all" {...node(f.index)} />)
          : null}
        <rect
          width={TILE}
          height={TILE}
          fill="none"
          stroke={p.tile.border}
          strokeWidth={p.tile.borderWidth}
          pointerEvents="none"
        />
      </g>
      {cloisters.map((f) => (f.kind === "cloister" ? <CloisterIcon key={`ci${f.index}`} at={up([50, 50])} p={p} /> : null))}
      {art.villages.map((v, i) => (
        <VillageIcon key={`v${i}`} at={up(v)} p={p} />
      ))}
      {cities.flatMap((f) => f.pennants.map((pt, i) => <Pennant key={`p${f.index}-${i}`} at={up(pt)} p={p} />))}
    </g>
    </g>
  );
}

export const TileSvg = memo(TileSvgImpl);

/** Standalone tile picture (HUD, remaining-tiles panel, previews). */
export function TileThumb({
  def,
  art,
  palette,
  rot = 0,
  size = 64,
  className,
  title,
}: {
  def: TileDef;
  art: TileArtSource;
  palette: BoardPalette;
  rot?: number;
  size?: number;
  className?: string;
  title?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="-1 -1 102 102"
      className={className}
      role="img"
      aria-label={title ?? `Tile ${def.id}`}
    >
      <PaletteDefs palette={palette} />
      <TileSvg def={def} art={art} palette={palette} rot={rot} />
    </svg>
  );
}
