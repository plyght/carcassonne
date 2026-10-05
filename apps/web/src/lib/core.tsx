"use client";

// core.wasm on the main thread: the engine's tile catalog, core-geo tile/figure art,
// and the public-view rules online clients use for legal moves. The engine for local
// games runs separately in a Web Worker (./engine.ts). One fetch serves both: the
// browser caches the wasm URL.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { CoreGeo } from "@carcassonne/core-geo";
import { catalogFromKit, loadCoreKit, viewRules, type CoreKit, type TileCatalog, type ViewRules } from "@carcassonne/game-client";
import { createGeoArt, createGeoFigures, installArt, type FigureArtSource, type TileArtSource } from "@carcassonne/render-classic";

export interface CoreAssets {
  kit: CoreKit;
  catalog: TileCatalog;
  art: TileArtSource;
  figures: FigureArtSource;
  rules: ViewRules;
}

let loading: Promise<CoreAssets> | null = null;
let loaded: CoreAssets | null = null;

/** Load core.wasm once per page (bundled by Next as a static asset via `new URL(..., import.meta.url)`). */
export function loadCoreAssets(): Promise<CoreAssets> {
  loading ??= (async () => {
    const kit = await loadCoreKit();
    const geo = new CoreGeo(kit.instance);
    const assets: CoreAssets = {
      kit,
      catalog: catalogFromKit(kit),
      art: createGeoArt(geo),
      figures: createGeoFigures(geo),
      rules: viewRules(kit),
    };
    installArt({ tiles: assets.art, figures: assets.figures });
    loaded = assets;
    return assets;
  })();
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

const CoreContext = createContext<CoreAssets | null>(null);

export function CoreProvider({ children }: { children: ReactNode }) {
  const [assets, setAssets] = useState<CoreAssets | null>(loaded);
  useEffect(() => {
    let alive = true;
    loadCoreAssets().then(
      (a) => alive && setAssets(a),
      (e) => console.error("[core] failed to load core.wasm", e),
    );
    return () => {
      alive = false;
    };
  }, []);
  return <CoreContext.Provider value={assets}>{children}</CoreContext.Provider>;
}

/** Core assets, or null while core.wasm is loading. */
export function useCore(): CoreAssets | null {
  return useContext(CoreContext);
}
