// ┌──────────────────────────────────────────────────────────────────────────┐
// │ ENGINE SWAP POINT. When @carcassonne/core-wasm lands, replace the         │
// │ `loadDevEngine` import below with core-wasm's loader, e.g.                │
// │   export { loadCoreEngine as loadEngine } from "@carcassonne/core-wasm"; │
// │ (it must resolve to an EnginePort; see ./engine-port.ts).                 │
// └──────────────────────────────────────────────────────────────────────────┘
export { loadDevEngine as loadEngine } from "./dev-engine";

// Tile definitions the renderer and hover analysis use. Swap for the engine's
// exported tile table (or core-geo's) once available.
export { baseCatalog as tileCatalog } from "./dev-engine/tiles-base";
