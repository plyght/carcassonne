# @carcassonne/render-three

Three.js board renderer for the 3D styles (Tabletop, Cartoon, Living Diorama). Framework-agnostic: give it a canvas, a `CoreGeo` and protocol data.

```ts
import { BoardRenderer, THREE_STYLE_ENTRIES, loadGeo } from "@carcassonne/render-three";

const geo = await loadGeo(coreWasmUrl);                 // geo/anim side of core.wasm
const r = await BoardRenderer.create({ canvas, geo, style: "tabletop", camera: "tabletop", tier: "auto" });
r.setView(view);                                         // snap to a GameView
r.pushEvents(result.events, game.view());                // animate one apply() result, then settle
r.setPlacementHints({ tile: view.currentTile!, placements }); // legal cells + ghost on hover
r.on((e) => { if (e.type === "click") /* e.pick.cell, e.pick.feature, e.placement */ });
r.rotateGhost(1); r.setPendingPlacement(p, figureOptions);    // figure hotspots + extent highlight
r.setStyle("cartoon"); r.setCamera("top"); r.setTier("high"); r.setReducedMotion(true);
```

- **Style registry:** `THREE_STYLE_ENTRIES` (one `ThreeStyleEntry` per 3D style: `id`, `name`, `description`, `kind: "3d"`, `swatch`, `cameras`, `defaultCamera`, `mount(canvas, geo, options)`). On a live board, switching between 3D styles is `renderer.setStyle(id)`; it does not rebuild game state. `@carcassonne/render-three/styles` exports the packs and loader with no three.js import.
- **Style packs:** `packages/assets/styles/<id>/style.json`, validated by `loadStylePack` (types in `src/styles.ts`).
- **Backend:** `three/webgpu` `WebGPURenderer`. It falls back to WebGL2 when WebGPU is missing or its probe frame throws. After a failed WebGPU attempt the canvas is replaced by a clone, so use `renderer.canvas`.
- **Tiers:**
  - low: no shadows, no post.
  - medium: 1k PCF shadows.
  - high: 2k shadows, prop shadows, GTAO, tilt-shift.

  Each style pack picks which tiers get which effects.

## Playground

```sh
bun playground/serve.ts 5173            # http://localhost:5173/?seed=7&moves=30&style=tabletop
node playground/shoot.mjs               # docs/screenshots/3d-*.png (headless Chromium, WebGL2/SwiftShader)
node playground/shoot.mjs perf          # frame timings on a full board
```

Query params:

| Param | Values |
|---|---|
| `seed` | number |
| `moves` | moves to fast-forward |
| `style` | style id |
| `camera` | `top`, `tabletop`, `orbit`, `cinematic` |
| `tier` | `low`, `medium`, `high` |
| `backend` | `auto`, `webgpu`, `webgl` |
| `capture` | `1` |
| `hints` | `0` or `1` |
| `look` | `city` or `cx,cz,extent` |
| `reduced` | `1` |
