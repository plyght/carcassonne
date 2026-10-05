import type { FigureKind } from "@carcassonne/protocol";

import type { MarkerShape } from "./palette";

// 24×24 silhouettes.
export const MEEPLE_PATH =
  "M12 1.5C14.6 1.5 16.3 3.4 16.3 5.8C16.3 7.2 15.7 8.3 14.8 9.1L21.2 10.6C22.8 11 23.3 12.4 22.5 13.7C21.9 14.6 20.8 14.9 19.6 14.6L16.6 13.9L19.9 21.2C20.3 22.1 19.7 22.9 18.7 22.9L14.6 22.9L12 18.2L9.4 22.9L5.3 22.9C4.3 22.9 3.7 22.1 4.1 21.2L7.4 13.9L4.4 14.6C3.2 14.9 2.1 14.6 1.5 13.7C0.7 12.4 1.2 11 2.8 10.6L9.2 9.1C8.3 8.3 7.7 7.2 7.7 5.8C7.7 3.4 9.4 1.5 12 1.5Z";
export const ABBOT_PATH =
  "M12 1.2C14.9 1.2 16.8 3.4 16.8 6.1C16.8 7.4 16.3 8.5 15.6 9.3C17.7 10.5 18.7 12.7 19.1 15.1L20.8 22.9L3.2 22.9L4.9 15.1C5.3 12.7 6.3 10.5 8.4 9.3C7.7 8.5 7.2 7.4 7.2 6.1C7.2 3.4 9.1 1.2 12 1.2Z";

/**
 * Figure outlines (24×24 box, feet at the bottom). The procedural set below is the
 * classic meeple (round head, arms straight out, legs apart) and a hooded abbot.
 * core-geo will provide canonical outlines from Zig (`geo_figure`) behind this.
 */
export interface FigureArtSource {
  readonly name: string;
  /** SVG path for the standing figure. */
  path(kind: FigureKind): string;
  /** Path for a farmer lying down; omit to rotate the standing path by 90°. */
  lyingPath?(kind: FigureKind): string | undefined;
  /** Where the colour-blind marker sits on the body. */
  markerAt(kind: FigureKind): readonly [number, number];
}

export const proceduralFigures: FigureArtSource = {
  name: "procedural",
  path: (kind) => (kind === "abbot" ? ABBOT_PATH : MEEPLE_PATH),
  markerAt: (kind) => (kind === "abbot" ? [12, 15.5] : [12, 13]),
};

export function MarkerGlyph({ shape, cx, cy, r, fill }: { shape: MarkerShape; cx: number; cy: number; r: number; fill: string }) {
  switch (shape) {
    case "circle":
      return <circle cx={cx} cy={cy} r={r} fill={fill} />;
    case "square":
      return <rect x={cx - r * 0.85} y={cy - r * 0.85} width={r * 1.7} height={r * 1.7} fill={fill} />;
    case "triangle":
      return <path d={`M${cx} ${cy - r}L${cx + r} ${cy + r * 0.8}L${cx - r} ${cy + r * 0.8}Z`} fill={fill} />;
    case "diamond":
      return <path d={`M${cx} ${cy - r * 1.1}L${cx + r} ${cy}L${cx} ${cy + r * 1.1}L${cx - r} ${cy}Z`} fill={fill} />;
    case "star": {
      const pts: string[] = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 ? r * 0.45 : r * 1.1;
        pts.push(`${(cx + Math.cos(a) * rr).toFixed(2)} ${(cy + Math.sin(a) * rr).toFixed(2)}`);
      }
      return <path d={`M${pts.join("L")}Z`} fill={fill} />;
    }
    case "cross":
      return (
        <path
          d={`M${cx - r * 0.35} ${cy - r}h${r * 0.7}v${r * 0.65}h${r * 0.65}v${r * 0.7}h${-r * 0.65}v${r * 0.65}h${-r * 0.7}v${-r * 0.65}h${-r * 0.65}v${-r * 0.7}h${r * 0.65}Z`}
          fill={fill}
        />
      );
  }
}


export interface FigureTokenProps {
  x: number;
  y: number;
  size?: number;
  kind: FigureKind;
  fill: string;
  ink: string;
  outline: string;
  marker: MarkerShape;
  /** Farmers lie down (visual only, PRD §5.4). */
  lying?: boolean;
  title?: string;
  className?: string;
  /** Outline source; core-geo's figures drop in here. */
  figures?: FigureArtSource;
  /** Translucent placement preview. */
  ghost?: boolean;
}

function FigureBody({
  kind,
  fill,
  ink,
  outline,
  marker,
  lying,
  figures,
  strokeWidth,
  ghost,
}: Omit<FigureTokenProps, "x" | "y" | "size" | "title" | "className"> & { strokeWidth: number }) {
  const src = figures ?? proceduralFigures;
  const lyingPath = lying ? src.lyingPath?.(kind) : undefined;
  const [mx, my] = src.markerAt(kind);
  return (
    <g transform={lying && !lyingPath ? "rotate(-90 12 13)" : undefined}>
      <path
        d={lyingPath ?? src.path(kind)}
        fill={fill}
        fillOpacity={ghost ? 0.62 : 1}
        stroke={outline}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeDasharray={ghost ? "2 1.5" : undefined}
      />
      {ghost ? null : <MarkerGlyph shape={marker} cx={mx} cy={my} r={2.6} fill={ink} />}
    </g>
  );
}

/** A meeple or abbot token centred on (x, y) in board units. */
export function FigureToken({ x, y, size = 24, title, className, ...body }: FigureTokenProps) {
  const k = size / 24;
  return (
    <g transform={`translate(${x - size / 2} ${y - size / 2}) scale(${k})`} className={className} pointerEvents="none">
      {title ? <title>{title}</title> : null}
      {body.ghost ? null : <ellipse cx={12.6} cy={22.6} rx={9} ry={2.2} fill="rgba(0,0,0,0.28)" />}
      <FigureBody {...body} strokeWidth={1.3} />
    </g>
  );
}

/** Standalone icon (HUD, score panel). */
export function FigureIcon({
  kind = "meeple",
  fill,
  ink,
  outline = "rgba(0,0,0,0.55)",
  marker,
  size = 18,
  className,
  title,
  lying,
  figures,
}: {
  kind?: FigureKind;
  fill: string;
  ink: string;
  outline?: string;
  marker: MarkerShape;
  size?: number;
  className?: string;
  title?: string;
  lying?: boolean;
  figures?: FigureArtSource;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} role={title ? "img" : undefined} aria-hidden={title ? undefined : true}>
      {title ? <title>{title}</title> : null}
      <FigureBody kind={kind} fill={fill} ink={ink} outline={outline} marker={marker} lying={lying} figures={figures} strokeWidth={1.2} />
    </svg>
  );
}
