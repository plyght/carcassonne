# Handoff: add native 3D to zpui, for the Carcassonne desktop app

**For:** an agent that has both repos checked out:
- **`plyght/zpui`**: the target. You add a generic 3D module here.
- **`plyght/carcassonne`**: the source of truth. Read designs, the spike patch and the asset/geometry formats from it. Don't change it unless Part B below is requested.

**Owner:** plyght. Commit as `plyght <plyght@peril.lol>`, with **no `Co-Authored-By` / `Claude-Session` / other AI trailers** in commit messages.

---

## 0. Context in two minutes

`carcassonne` is a full Carcassonne game (base game, River, Abbot). It has a web client (Next.js + Three.js, deployed on Vercel) and a native **desktop client for macOS and Linux built on zpui**. Most of the game is written once in a shared Zig core (`carcassonne/packages/core`), which runs as WASM on web and natively on desktop:
- `engine/`: rules. Deterministic: seed + moves give the same game everywhere.
- `ai/`: bots.
- `geo/`: **procedural tile geometry**: 2D paths, 3D meshes, prop instances, meeple figures.
- `anim/`: event → animation timeline.

Web already renders that geometry in 3D with Three.js (`carcassonne/packages/render-three`) in several **styles** (Tabletop, Cartoon, Diorama) defined as data (`carcassonne/packages/assets/styles/*/style.json`).

**zpui** (Zig 0.17 port of zui/gpui) has Vulkan (Linux) and Metal (macOS) renderers for 2D UI only. **It has no 3D.** Research confirmed nothing in zui or upstream gpui can be ported. Your job is to add a **generic, reusable 3D module to zpui**, so the Carcassonne desktop app can draw the same boards natively, matching the web look.

**Keep zpui generic.** No Carcassonne-specific code goes into zpui. Game code lives in `carcassonne/apps/desktop` (Part B).

## 1. Read first (all paths relative to the carcassonne repo)

| File | Why |
|---|---|
| `docs/research/zpui-3d.md` | **The design.** Architecture decision (offscreen 3D target composited in draw order), the `zpui.three` API sketch, backend work, shaders, phases, risks. Follow it unless you find a concrete reason not to; record deviations. |
| `docs/research/zpui-3d-spike.patch` | A **working Vulkan spike** (about 1.3k lines) made against zpui commit **`066bd86`**. It has the `Viewport3D` primitive, `src/three/{math,scene3d}.zig`, the RGBA16F + D32F 4× MSAA offscreen pass, reverse-Z, GGX shading, a composite pipeline with tonemap, rounded corners and clip, and a `render-test-3d` golden on lavapipe with zero validation errors. Start from it: `git apply` it on a branch from `066bd86` (or rebase it onto current zpui main). |
| `docs/research/zpui-3d-spike.png` | What the spike renders. |
| `docs/PRD.md` §6.3, §7.4 | Product requirements: visual styles, camera modes, performance tiers, desktop architecture. |
| `docs/design/inspiration/README.md` + `tabletop-diorama-01.webp` | **The target look** for the Tabletop style. |
| `docs/screenshots/3d-tabletop-*.png`, `3d-cartoon*.png`, `3d-diorama.png` | What the web renderer produces today. **Desktop should match these.** |
| `packages/core/src/geo/README.md` | The **CGEO geometry format** the desktop app will feed into your API (vertex attributes, per-vertex feature ids, prop instances with variant and tint, figure meshes). |
| `packages/assets/styles/*/style.json` + `packages/render-three/src/` | How each style maps to materials, lights and post effects. This is the reference implementation to reach parity with. |
| `docs/CONTRACT.md` | Cross-package contract (coordinates, ownership). |

## 2. Part A (required): `zpui.three`

### Deliverables in zpui
1. **The module** `src/three/` exported as `zpui.three`, plus the `Viewport3D` scene primitive and a **`viewport3d(scene)` element** (`window.paintViewport3D`), working on **both Vulkan and Metal**.
2. **Mesh input that fits CGEO without copying into a fixed layout.** At minimum:
   - positions, normals, uv, and an optional `u32` per-vertex **id attribute** (feature id),
   - u32 indices,
   - persistent GPU buffers (upload once, draw many times; not re-copied per frame as in the spike).
3. **Instancing** with per-instance transform plus **tint (rgba)** and an optional **u32 pick id**. Carcassonne draws hundreds of houses, bushes and towers via instancing.
4. **Materials (shading models).** A small fixed set, all on both backends:
   - `pbr`: glTF metallic-roughness (base colour, roughness, metallic, optional textures).
   - `toon`: N-band ramp, plus **inverted-hull or screen-space outline** with configurable width and colour.
   - `flat`: unlit.
   - Plus **per-draw tint**.
5. **Lighting:** one directional key light with **shadow map (PCF)**, hemisphere/ambient fill, optional SH9 environment. Point lights are optional (later).
6. **Post chain** (each one toggleable, for performance tiers):
   - HDR + exposure + tonemap (the spike's Khronos PBR Neutral),
   - **SSAO** (or a cheaper baked/approximate AO),
   - **tilt-shift depth-of-field**,
   - outline pass if not done per-mesh,
   - FXAA/MSAA.
7. **Cameras:** perspective and orthographic, with `Camera.ray(viewport, point)` for picking.
8. **Picking:**
   - a CPU ray against a plane (table → cell),
   - a ray against mesh triangles returning `{pick id, vertex id attribute}`, so the app can tell which tile feature was clicked.
   - A GPU id-buffer readback is fine as an alternative if it's cleaner.
9. **2D UI over 3D must keep working.** Backdrop blur and translucent HUD chips over the viewport, as the spike already shows.
10. **glTF loading** (cgltf under `vendor/`), for generic assets; Carcassonne's own meshes are procedural.
11. **Shaders:** a single GLSL source → SPIR-V (glslc) → **generated MSL via SPIRV-Cross, checked in**, plus a CI drift check. Compile the MSL variant without `-O` so names survive. If generation is impractical, hand-written MSL pairs are acceptable; record why.
12. **Tests and CI:**
    - unit tests for math, the store and picking,
    - `zig build render-test-3d` goldens on **lavapipe** and **Metal** (`macos-15-intel`, like the existing GPU jobs), covering:
      - lit PBR mesh with shadow,
      - toon + outline,
      - instanced props with tint,
      - post on and off,
      - 2D UI over 3D.
    - The existing 2D `render-test` must still match exactly.
    - Zero Vulkan validation errors.
13. **A demo:** `examples/three_demo.zig`, a windowed demo with an orbit camera, a ground slab, instanced boxes and a toon toggle, so a human can try it on Mac and Linux.
14. **Docs:** `docs/THREE.md` in zpui covering the API, threading/frame model, resource lifetimes and performance notes. Update `docs/PLAN.md`.

### Performance budget
A full Carcassonne board is about 80 tiles, about 1–2M triangles on high and about 0.5M on low, about 200–350 draw calls before instancing, with 25 figures. Target **60 fps at 1440p on an M1 / recent Intel iGPU on "medium"** (shadows + MSAA, no SSAO/DOF). Report GPU timings (timestamp queries) for each tier.

### zpui conventions (from its `docs/PLAN.md`)
- Zig **0.17.0** only. C headers go through `b.addTranslateC` (`@cImport` is gone).
- Vulkan 1.3 dynamic rendering. Instance data is pulled through buffer device address in push constants; no vertex-input state. Follow the existing pattern.
- Metal compiles shaders at runtime from source (no Xcode needed). `zig build metal-check -Dtarget=aarch64-macos` must still pass from Linux.
- Apple Silicon CI runners have no Metal device, so GPU jobs run on `macos-15-intel`.

### Dev setup (Linux)
```sh
# Zig 0.17.0
curl -LO https://ziglang.org/download/0.17.0/zig-x86_64-linux-0.17.0.tar.xz && tar xf zig-*.tar.xz
sudo apt-get install libvulkan-dev mesa-vulkan-drivers glslc spirv-cross vulkan-validationlayers \
  libwayland-dev wayland-protocols libxkbcommon-dev libxkbcommon-x11-dev libx11-dev libx11-xcb-dev \
  libxcb1-dev libxcb-xkb-dev libxcursor-dev libxi-dev libxrandr-dev libfreetype-dev libharfbuzz-dev \
  libfontconfig-dev fonts-inter fonts-noto-core
export VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json   # software Vulkan (lavapipe)
zig build test && zig build render-test   # baseline must pass before you change anything
```

### Suggested order
1. Apply the spike → green on lavapipe.
2. Metal half → green on CI.
3. `viewport3d` element + live demo.
4. Persistent buffers + instancing + picking.
5. Shadows + MSAA.
6. Toon/outline/flat.
7. Post chain (SSAO, tilt-shift).
8. glTF.
9. Docs.

Commit in small, reviewable steps. Each step keeps CI green.

### Git
Work on a branch `three` in zpui. Merge to `main` when CI is green (the owner prefers changes landing on main). Identity: `plyght <plyght@peril.lol>`, no AI trailers.

## 3. Part B (only if the owner asks): `carcassonne/apps/desktop`

This is the game-side consumer. It's included here so the zpui API is designed to fit it.
- **Build:**
  - A Zig app depending on zpui via `build.zig.zon` (pinned commit) and on the shared core via `carcassonne/packages/core` (`b.addModule("core")`; the native `engine`, `ai`, `geo` and `anim` modules).
  - Assets come from `carcassonne/packages/assets` (style packs, audio).
- **Rendering:**
  - Board: build zpui meshes from `geo` output directly in Zig (no WASM on desktop): terrain per (tile, rot), instanced props by kind and variant with tint, figure meshes.
  - Materials and post come from `style.json` (parse the same JSON the web uses).
  - Play `anim` timelines.
- **Styles:**
  - The **Classic Board 2D style** can be drawn with zpui's existing 2D path renderer from `geo` 2D paths. That makes it the first playable desktop milestone, before 3D is done.
  - 3D styles arrive once Part A lands.
- **UI:** native zpui HUD and menus mirroring the web app's (`carcassonne/apps/web`). Offline hot-seat and vs-AI first, using the native engine and AI directly.
- **Online:** the same WebSocket protocol as web (`carcassonne/packages/protocol/src/wire.ts`) against the Vercel server. Auth through better-auth's device flow.
- **Packaging:** `.app` and a Linux tarball, reusing zpui's existing bundle/dist build steps.

If you do Part B, coordinate: only touch `carcassonne/apps/desktop/**`, plus additive changes where truly needed. Commit as plyght, no trailers, push to carcassonne `main` only with all checks green:
- `bun run check-types`,
- `bun run test`,
- `cd packages/core && zig build test`.

## 4. Report back (paste this to the owner when done)
- The zpui commit hash on `main`, and a short API summary (types and functions the game will call).
- Screenshots or goldens for Vulkan and Metal, plus demo screenshots.
- GPU timings per tier, on whatever hardware you have, and on lavapipe.
- Deviations from `docs/research/zpui-3d.md` and why.
- Known gaps.
