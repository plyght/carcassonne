// @carcassonne/render-three: the Tabletop / Cartoon / Diorama 3D styles.
//
// Style registry integration (apps/web): every 3D style is a `ThreeStyleEntry`
// in `THREE_STYLE_ENTRIES`. `mount()` creates one BoardRenderer on a canvas;
// switching between 3D styles on a live board is `renderer.setStyle(id)`
// (no rebuild of game state).
import type { CoreGeo } from "@carcassonne/core-geo";
import { BoardRenderer, type BoardRendererOptions } from "./renderer";
import { CAMERA_MODES, type CameraMode } from "./camera";
import { STYLE_IDS, STYLE_PACKS, type BuiltinStyleId } from "./styles";

export { BoardRenderer } from "./renderer";
export type { BoardRendererOptions, GeoProvider, PickResult, RendererEvent, RendererStats } from "./renderer";
export { CameraRig, CAMERA_MODES, type CameraMode, type RigState } from "./camera";
export { createRenderer, type BackendKind, type BackendPreference } from "./backend";
export { TimelinePlayer, ManualClock, RealClock, ease, type Clock } from "./timeline";
export { TileGeometryCache, buildTileGeometry, rotXZ, type TileGeometry, type GeoSource } from "./tile-cache";
export { featureAt, featureAtGrid, featureExtent, rayPlaneY, cellAt, toCanonical, rotatePorts, opposingPort } from "./picking";
export { PropKit, VARIANTS as PROP_VARIANTS, type PropSource } from "./props";
export * from "./styles";

export interface ThreeStyleEntry {
  id: BuiltinStyleId;
  name: string;
  description: string;
  kind: "3d";
  /** Swatch colours for a style picker / preview card. */
  swatch: string[];
  cameras: CameraMode[];
  defaultCamera: CameraMode;
  /**
   * Create a renderer for this style on `canvas`. `geo` is a CoreGeo over the
   * shared core.wasm (see `loadGeo`).
   */
  mount(canvas: HTMLCanvasElement, geo: CoreGeo, options?: Partial<BoardRendererOptions>): Promise<BoardRenderer>;
}

export const THREE_STYLE_ENTRIES: ThreeStyleEntry[] = STYLE_IDS.map((id) => {
  const s = STYLE_PACKS[id];
  return {
    id,
    name: s.name,
    description: s.description,
    kind: "3d" as const,
    swatch: [s.palette.grass, s.palette.roofs[0]!, s.palette.road, s.palette.stone, s.palette.slab],
    cameras: CAMERA_MODES,
    defaultCamera: "tabletop" as CameraMode,
    mount: (canvas: HTMLCanvasElement, geo: CoreGeo, options: Partial<BoardRendererOptions> = {}) => BoardRenderer.create({ ...options, canvas, geo, style: id }),
  };
});

/** Instantiate the geo/anim side of core.wasm (fetches `url`, e.g. the bundled `@carcassonne/core-wasm/core.wasm`). */
export async function loadGeo(url: string | URL): Promise<CoreGeo> {
  const { CoreGeo } = await import("@carcassonne/core-geo");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`render-three: failed to fetch ${url}: ${res.status}`);
  return CoreGeo.instantiate(await res.arrayBuffer());
}
