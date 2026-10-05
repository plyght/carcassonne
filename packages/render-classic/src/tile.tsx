import { memo, type ReactNode } from "react";

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

function GardenIcon({ at, p }: { at: Pt; p: BoardPalette }) {
  const [x, y] = at;
  const g = p.garden ?? { fill: "#6f9c47", hedge: "#3f6a2a", bloom: "#f4d35e" };
  return (
    <g transform={`translate(${x} ${y})`} pointerEvents="none">
      <path d="M-1.4 6V1.5h2.8V6Z" fill={p.building.outline} opacity={0.8} />
      <circle cx={0} cy={-2.5} r={5.4} fill={g.hedge} stroke={p.building.outline} strokeWidth={1} />
      <circle cx={-3.6} cy={1.8} r={3.3} fill={g.hedge} stroke={p.building.outline} strokeWidth={0.9} />
      <circle cx={3.6} cy={1.8} r={3.3} fill={g.hedge} stroke={p.building.outline} strokeWidth={0.9} />
      <circle cx={-1.8} cy={-4} r={1} fill={g.bloom} />
      <circle cx={2.2} cy={-1.5} r={1} fill={g.bloom} />
      <circle cx={-3.4} cy={1.6} r={0.9} fill={g.bloom} />
      <circle cx={3.8} cy={2.2} r={0.9} fill={g.bloom} />
    </g>
  );
}

/** Tile drawn from core-geo layers (regions, bands, walls, buildings) in geo draw order. */
function LayeredTile({ art, palette: p, rot, x = 0, y = 0, hitTest, className, opacity }: Omit<TileSvgProps, "art"> & { art: TileArt }) {
  const layers = art.layers!;
  const node = (i: number | null) => (hitTest && i !== null ? { "data-node": `${x},${y},${i}` } : {});
  const up = (pt: Pt) => rotatePoint(pt, rot);
  const roadish = layers.filter((l) => l.kind === "road" && (l.role === "region" || l.role === "plaza"));
  const firstRoad = layers.findIndex((l) => l.kind === "road" && (l.role === "region" || l.role === "plaza"));
  const casing = Math.max(1.2, (p.road.casingWidth - p.road.fillWidth) / 2 + 0.4);
  const garden = p.garden ?? { fill: p.tile.fieldShade, hedge: p.building.outline, bloom: p.pennant.fill };
  const riverEdge = p.river.edge ?? p.river.fill;
  const icons: ReactNode[] = [];

  const drawn = layers.map((l, i) => {
    const key = `${l.role}${i}`;
    switch (l.role) {
      case "region":
        if (l.kind === "field")
          return <path key={key} d={l.d} fill={p.tile.field} stroke={p.tile.fieldShade} strokeWidth={0.6} pointerEvents={hitTest ? "all" : "none"} {...node(l.feature)} />;
        if (l.kind === "river")
          return <path key={key} d={l.d} fill={p.river.fill} stroke={riverEdge} strokeWidth={1.1} strokeLinejoin="round" pointerEvents={hitTest ? "all" : "none"} {...node(l.feature)} />;
        if (l.kind === "city")
          return (
            <g key={key}>
              <path d={l.d} fill={p.city.fill} pointerEvents={hitTest ? "all" : "none"} {...node(l.feature)} />
              {p.city.hatch ? <path d={l.d} fill={`url(#${hatchId(p)})`} pointerEvents="none" /> : null}
            </g>
          );
        if (l.kind === "road") {
          if (i !== firstRoad) return null;
          // Two passes over every road band and plaza: casing strokes, then fills, so junctions merge cleanly.
          return (
            <g key={key}>
              {roadish.map((r, j) => (
                <path key={`c${j}`} d={r.d} fill={p.road.casing} stroke={p.road.casing} strokeWidth={casing * 2} strokeLinejoin="round" pointerEvents="none" />
              ))}
              {roadish.map((r, j) => (
                <path key={`f${j}`} d={r.d} fill={p.road.fill} pointerEvents={hitTest ? "all" : "none"} {...node(r.feature)} />
              ))}
            </g>
          );
        }
        return <path key={key} d={l.d} fill={p.tile.fieldShade} pointerEvents="none" />;
      case "plaza":
        if (i === firstRoad) {
          return (
            <g key={key}>
              {roadish.map((r, j) => (
                <path key={`c${j}`} d={r.d} fill={p.road.casing} stroke={p.road.casing} strokeWidth={casing * 2} strokeLinejoin="round" pointerEvents="none" />
              ))}
              {roadish.map((r, j) => (
                <path key={`f${j}`} d={r.d} fill={p.road.fill} pointerEvents={hitTest ? "all" : "none"} {...node(r.feature)} />
              ))}
            </g>
          );
        }
        return null;
      case "centerline":
        if (l.kind === "river")
          return p.river.ripple ? (
            <path key={key} d={l.d} fill="none" stroke={p.river.ripple} strokeWidth={1.2} strokeDasharray="5 6" strokeLinecap="round" pointerEvents="none" />
          ) : null;
        return (
          <g key={key}>
            {p.road.dash ? <path d={l.d} fill="none" stroke={p.road.casing} strokeWidth={0.9} strokeDasharray={p.road.dash} pointerEvents="none" /> : null}
            {hitTest ? <path d={l.d} stroke="transparent" strokeWidth={14} fill="none" pointerEvents="stroke" {...node(l.feature)} /> : null}
          </g>
        );
      case "wall":
        return (
          <g key={key} pointerEvents="none">
            <path d={l.d} stroke={p.city.wall} strokeWidth={p.city.wallWidth} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            {p.city.crenel !== p.city.wall ? (
              <path d={l.d} stroke={p.city.crenel} strokeWidth={p.city.wallWidth * 0.55} strokeDasharray="2.2 2.2" fill="none" />
            ) : null}
          </g>
        );
      case "building": {
        const at = up(l.center ?? [50, 50]);
        if (l.kind === "garden") {
          icons.push(<GardenIcon key={`gi${i}`} at={at} p={p} />);
          return (
            <path key={key} d={l.d} fill={garden.fill} stroke={garden.hedge} strokeWidth={1.6} strokeDasharray="3 1.6" pointerEvents={hitTest ? "all" : "none"} {...node(l.feature)} />
          );
        }
        icons.push(<CloisterIcon key={`ci${i}`} at={[at[0], at[1] + 2]} p={p} />);
        return <path key={key} d={l.d} fill="transparent" pointerEvents={hitTest ? "all" : "none"} {...node(l.feature)} />;
      }
    }
  });

  const villages = layers.filter((l) => l.role === "plaza" && l.center).map((l) => up(l.center!));
  return (
    <g transform={`translate(${x * TILE} ${y * TILE})`} opacity={opacity}>
      <g className={className}>
        <g transform={rot ? `rotate(${rot * 90} 50 50)` : undefined}>
          <rect width={TILE} height={TILE} fill={p.tile.field} />
          {drawn}
          <rect width={TILE} height={TILE} fill="none" stroke={p.tile.border} strokeWidth={p.tile.borderWidth} pointerEvents="none" />
        </g>
        {icons}
        {villages.map((v, i) => (
          <VillageIcon key={`v${i}`} at={v} p={p} />
        ))}
        {art.features.flatMap((f) => f.pennants.map((pt, i) => <Pennant key={`p${f.index}-${i}`} at={up(pt)} p={p} />))}
      </g>
    </g>
  );
}

function TileSvgImpl({ def, art: source, palette: p, rot, x = 0, y = 0, hitTest, className, opacity }: TileSvgProps) {
  const art: TileArt = source.get(def);
  if (art.layers) return <LayeredTile def={def} art={art} palette={p} rot={rot} x={x} y={y} hitTest={hitTest} className={className} opacity={opacity} />;
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
