// Engine Web Worker entry: runs the rules engine (dev TS engine today, core-wasm
// after the swap in packages/game-client/src/engine.ts) off the main thread.
import "@carcassonne/game-client/worker/worker-env";

import { loadEngine } from "@carcassonne/game-client/engine";
import { serveEngine } from "@carcassonne/game-client/worker";

serveEngine(loadEngine());
