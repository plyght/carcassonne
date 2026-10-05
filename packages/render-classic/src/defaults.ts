// App-wide default art sources. The app installs core-geo art once core.wasm has
// loaded (`installArt`); until then (and in SSR) components use the procedural art.
// Type-only imports: figures.tsx and board.tsx import this module.
import type { FigureArtSource } from "./figures";
import type { TileArtSource } from "./tile-art";

let tileArt: TileArtSource | null = null;
let figureArt: FigureArtSource | null = null;

export function installArt(sources: { tiles?: TileArtSource; figures?: FigureArtSource }) {
  if (sources.tiles) tileArt = sources.tiles;
  if (sources.figures) figureArt = sources.figures;
}

export const installedTileArt = (): TileArtSource | null => tileArt;
export const installedFigureArt = (): FigureArtSource | null => figureArt;
