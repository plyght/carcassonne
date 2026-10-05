# PRD: Carcassonne (codename **Carcassonne**, private build)

| | |
|---|---|
| Status | Draft v0.2 (open questions resolved) |
| Date | 2026-10-05 |
| Owner | @plyght |
| Distribution | Private / personal use only. Not for public release (see §13 IP) |
| Related | `docs/research/zpui-3d.md` (3D-in-zpui research and design) |

---

## 1. Summary

A digital adaptation of the Carcassonne board game, with **full rules parity** for the base game plus **The River** and **The Abbot** (both in the current box), playable on:

- **Web**: Next.js and Three.js, deployed to Vercel.
- **Desktop**: native macOS and Linux apps built on **zpui** (our Zig port of gpui), with a new native 3D renderer.

The table looks like a **realistic tabletop that comes to life**: a wooden table under warm light, cardboard tiles and wooden meeples. As each tile is placed it "pops" into a living 3D diorama: city walls rise, the cloister bell swings, sheep graze, carts roll down finished roads. When the camera pulls back, the board reads as a clean map.

Play modes: online multiplayer (invite rooms, ranked play, spectating), local hot-seat, AI opponents (Easy→Expert), replays, and a tutorial.

**Write the game once.** The rules, the AI, procedural tile geometry, the animation timeline and the network protocol all live in a single **Zig core**. That core compiles to WASM for the browser and the Bun server, and to native code for desktop. The renderer and the UI shell are the only parts built per platform.

## 2. Goals and non-goals

### Goals
1. **Rules parity.** Every rule in the base game and River rulebooks is implemented and covered by tests, including edge cases (unplaceable tiles, meeple-sharing ties, field and city adjacency, River U-turn restriction).
2. **One rules engine.** The same Zig engine runs on the server (authoritative), in the browser (prediction, offline AI) and on desktop. Games are deterministic, so `(seed, ruleset, moves)` always reproduces the same game.
3. **"Cooler than the box."** Tabletop 3D with live dioramas, scoring cinematics, ambient sound, and a classic 2D top-down toggle.
4. **Native desktop that is not a webview.** zpui UI plus a native 3D pipeline (Vulkan/Metal), at 60 fps or better on integrated GPUs.
5. **Full online stack.** Accounts, invite rooms, ranked ladder, spectating, replays and game clocks.

### Non-goals (v1)
- Expansions other than the River and the Abbot (the engine is still designed so they can be added; see §5.8).
- Windows, iOS and Android native apps. The web build should stay usable on tablets but is not optimised for them.
- Public distribution, monetisation, in-app purchases.
- Free-text chat (chat is **emoji reactions only**, see §6.8).
- Bot training through ML self-play (MCTS only).

## 3. Target users and use cases

| Persona | Need |
|---|---|
| **Owner and friends** | Spin up a room, send a link, play on web or desktop in mixed groups. |
| **Solo player** | Play offline against Easy→Expert AI on desktop, with undo and hints. |
| **Couch group** | Hot-seat on one laptop or TV with 2–5 players. |
| **Competitive player** | Ranked ladder with clocks, then review replays move by move. |
| **New player** | Interactive tutorial (they "haven't played in forever"). |

## 4. Platforms and stack

The monorepo is scaffolded with Better-T-Stack:

```
bun create better-t-stack@latest carcassonne --frontend next --backend elysia --runtime bun \
  --api trpc --auth better-auth --payments none --database postgres --orm drizzle \
  --db-setup neon --package-manager bun --git --web-deploy vercel --server-deploy docker \   # overridden: server also deploys to Vercel (§7.3)
  --install --addons turborepo --examples none
```

| Layer | Tech |
|---|---|
| Monorepo | Turborepo + Bun workspaces |
| Web app | Next.js (App Router), React, Three.js (WebGPU renderer with WebGL2 fallback), deployed on Vercel |
| API | Elysia on Bun, tRPC for request/response, WebSockets for real-time game traffic. **Deployed serverless on Vercel** (Bun runtime, `Bun.serve` entrypoint with WebSocket handlers; Vercel Functions WebSocket support, public beta since June 2026). Stateless instances; room state in Postgres + Redis (§7.3) |
| Realtime fan-out | Redis (Upstash via Vercel Marketplace) pub/sub per room, plus locks and the matchmaking queue |
| Auth | better-auth (email + OAuth; device-authorization flow for desktop) |
| DB | Postgres on Neon, Drizzle ORM |
| Core | **Zig** (0.17, matching zpui): rules engine, AI, procedural geometry, animation timeline, protocol codec. Builds to `wasm32` (web + server) and native (desktop) |
| Desktop | **zpui** (Zig, Vulkan on Linux, Metal on macOS) with a new 3D module; ships as `.app` and a Linux tarball/AppImage |

### Proposed repo layout
```
apps/
  web/              Next.js: lobby, game client (Three.js), account/profile pages, replays
  server/           Elysia: tRPC routers, WS game rooms, matchmaking, clocks
  desktop/          zpui app: native menus/HUD + native 3D board
packages/
  core/             Zig: engine/, ai/, geo/ (procedural meshes), anim/ (timeline), proto/
  core-wasm/        TS bindings + build of core → wasm (used by web + server)
  protocol/         TS types generated from core/proto schema (single source of truth)
  render-three/     Three.js renderer consuming core geometry + anim timeline
  assets/           glTF props, PBR textures, audio, fonts (shared by web + desktop)
  db/  auth/  api/  Better-T-Stack packages
docs/
```

## 5. Game rules scope (parity spec)

### 5.1 Components
- **Base game: 72 land tiles** (including the start tile with a darker back) across **24 tile types**: roads, city segments (some with **pennants**), cloisters, fields, and road ends at crossroads, villages or cities.
- **The River: 12 tiles**: a spring, a lake, and 10 river pieces (straights, curves, and pieces with roads, cities or cloisters).
- **Meeples:** 7 per player plus 1 abbot, in 5 colours (2–5 players). A 6th colour is reserved for future expansions.
- **Scoreboard** with the 50/100 lap marker (cosmetic, since we track exact scores).
- The exact tile distribution is a data file (`core/engine/tiles/base.zon`, `river.zon`) verified against the rulebook manifest and checked by a unit test that counts tiles by type.

### 5.2 Turn structure
1. **Draw and place a tile.** It must touch at least one existing tile, and every touching edge must match (road↔road, city↔city, field↔field). Tiles can be rotated in 90° steps.
   - If the tile cannot be placed anywhere, it is shown to everyone, removed from the game, and the player draws again.
2. **Optionally place one meeple** from supply on a feature of the tile just placed: road (thief), city (knight), cloister (monk) or field (farmer). The feature it joins must not already contain a meeple anywhere in its connected extent.
3. **Score completed features.** Return meeples from scored roads, cities and cloisters. Farmers stay until the end of the game.

### 5.3 Scoring (in game / end of game)
| Feature | Completed during game | Incomplete at end |
|---|---|---|
| Road | 1 per tile | 1 per tile |
| City | 2 per tile + 2 per pennant | 1 per tile + 1 per pennant |
| Cloister | 9 (cloister + all 8 neighbours) | 1 + 1 per neighbouring tile |
| Field | n/a (scored only at the end) | See §5.4 |

- **Majority:** the player(s) with the most meeples on a feature score it. Ties score full points for everyone tied. Meeples join features by connecting separate features through tile placement; you can never place directly into an occupied feature.
- A road loop and a road that ends at both ends are both "complete".
- **1st-edition variant:** a completed two-tile city scores 2 instead of 4 (part of the edition toggle).

### 5.4 Field scoring: selectable edition (house-rules menu)
| Edition | Rule |
|---|---|
| **3rd (default)** | Each field scores **3 points per completed city it touches** to its majority farmer holder(s). Farmers are placed lying down (visual only). |
| 2nd | Same 3/city per field. Note any wording differences surfaced during rulebook verification. |
| 1st | Each completed city scores **4** once, to the player(s) with the most farmers across *all* fields touching that city. |

> All three edition texts are verified against the official rulebooks before implementation. Rules unit tests cite rulebook page/figure IDs.

### 5.5 The River (on by default, toggleable)
- Setup: the **spring** is the start tile, river tiles are shuffled and placed first, and the **lake** is placed last. Then the regular start tile is shuffled into the land tiles (or set aside, per the rulebook option).
- Each river tile must extend the river.
- **No U-turns:** two consecutive curves may not turn the same way, so the river never folds back on itself.
- If a river tile cannot be placed legally, follow the rulebook's redraw procedure.

### 5.6 The Abbot (v1)
- Each player gets 1 **abbot** in addition to 7 meeples. Some base tiles (3rd edition) show **gardens** in field areas. The tile data carries a `garden` flag.
- The abbot may only be placed on a **cloister or garden** of the tile just placed (in place of a meeple). Normal meeples may not occupy gardens.
- A garden scores like a cloister: 9 when surrounded, otherwise 1 + 1 per neighbouring tile at game end.
- Instead of placing a figure, a player may **recall their abbot** from the board and immediately score its cloister/garden as if the game had ended.
- Toggle: "Abbot & gardens" (on by default). Rules text verified against the 3rd edition rulebook before implementation.

### 5.7 House rules and variants (v1)
Defaults are current (3rd edition) rules + River. The user hasn't played in a while, so the menu shows each option with a one-line explanation.
- Field-scoring edition (1st / 2nd / **3rd**)
- River on/off
- **Seeded shuffle:** a shareable seed for reproducible games, puzzles and bug reports
- Hand variant (hold 1–3 tiles and choose one): **P1**, off by default
- Turn clock settings (§6.6)
- Undo/takebacks (offline/AI/hot-seat only)
- **The Abbot (v1, on by default to match the current box):** see §5.6

### 5.8 Expansion-ready engine
- Tiles are data. Each tile is described by feature graphs (edge segments → features, plus extra flags: pennant, cloister, garden, inn, cathedral, etc.).
- Rules run as a **module pipeline** (`onSetup`, `legalPlacements`, `legalFigures`, `onPlaced`, `scoreFeature`, `onGameEnd`). Base and River are modules, and future expansions (Inns & Cathedrals, Traders & Builders…) register additional modules.

## 6. Features

### 6.1 Game modes
| Mode | Web | Desktop | Notes |
|---|---|---|---|
| Online room (invite link) | ✅ | ✅ | 2–5 players, mixed human/bots, guests allowed via link (an account is needed for ranked play) |
| Ranked **3–4 player FFA** | ✅ | ✅ | Glicko-2 rating, separate queues for 3p and 4p, server-picked seat order, fixed default ruleset. No 1v1 ranked queue in v1 |
| Hot-seat | ✅ | ✅ | Pass-the-device screen that hides upcoming tile info between turns |
| vs AI | ✅ | ✅ (offline) | Runs locally in WASM (web worker) or natively (desktop thread) |
| Spectate | ✅ | ✅ | **Live** view of public, ranked or invite games, with no delay |
| Replays | ✅ | ✅ | Every finished game; scrub, step, follow a player's POV; share link |
| Tutorial | ✅ | ✅ | Scripted seeded game teaching tile placement, each meeple role, completion and farmer scoring |

### 6.2 Core gameplay UX
- **Tile in hand:** the drawn tile floats above the table. Legal spots glow on the board as you hover them, and rotation (R, scroll wheel or a right-drag) snaps to the legal rotations.
- **Ghost preview:** the placed tile shows a translucent diorama. Hovering a feature shows the **feature extent outline**, the current meeple holders and a **projected score** if it completed now or at the end of the game.
- **Meeple placement:** clickable hotspots on the tile's features. The meeple animates in, and "Skip" is always available.
- **Hints (offline/AI only, toggleable):** highlight the best move according to Medium AI.
- **Undo/takebacks:** unlimited in solo/AI play, by vote in hot-seat, and disabled online. Ranked games never allow them.
- **Remaining-tiles panel:** counts by tile type (a common house aid that can be toggled off).
- **Score panel + scoreboard track** in 3D, with meeples walking along the track.
- **End-game sequence:** unfinished features and fields score one by one with cinematic camera moves, then a summary screen with per-category points.

### 6.3 Visual direction: "the tabletop comes to life"
- **Base layer (realistic):** PBR wooden table, linen-textured cardboard tiles with slightly bevelled edges and a printed top face, and wooden meeples with grain and soft contact shadows. Warm key light, cool fill light, and an HDR environment.
- **Life layer (3D dioramas):** each placed tile rises out of its printed art into low-poly-but-detailed relief:
  - **Cities:** walls and towers extrude along the city edges. Completed cities raise banners in the owner's colour and light their windows at dusk.
  - **Roads:** dirt with ruts. Completed roads get a cart that drives the full length.
  - **Cloisters:** a chapel with a swinging bell. When completed, monks gather.
  - **Fields:** wind-swept grass shader, sheep and cows (instanced), crops by region.
  - **River:** a flowing water shader, a mill wheel, ducks.
- **Procedural generation:** geometry is generated from each tile's feature graph (edges → wall splines, road splines, field polygons) in the **Zig core** (`core/geo`). Both web and desktop therefore get identical meshes. A small hand-made glTF prop kit covers meeple, tower, chapel, house, tree, sheep, cart and mill.
- **Camera:** an orbit/tabletop camera that frames the table at a tilt, with top-down **Classic 2D** mode one keystroke away. Optional tilt-shift depth of field and a day/night cycle that runs with the game (it reaches dusk at the last tile).
- **Scoring moments:** the feature outline pulses, points float up as coins, and the meeple hops back to its owner's supply.
- **Performance tiers:** Low (no shadows/DOF, baked props), Medium, High (shadows, SSAO, DOF, animated foliage). Auto-detected, with a manual override.
- **Accessibility:** colour-blind-safe meeple palette plus a shape/pattern marker on every meeple, reduced-motion mode (dioramas appear without the rise animation), full keyboard play, scalable UI text.

### 6.4 Audio
Adaptive ambient soundscape (birds, wind, river near river tiles), tile and meeple foley, scoring stingers, end-game fanfare. A music playlist with volume buses (master/music/SFX/ambience). Shared assets in `packages/assets/audio`.

### 6.5 Accounts and profiles (better-auth)
- Email/password and OAuth (GitHub, Google). Guests can join invite rooms with a nickname.
- Profile: display name, avatar, meeple colour preference, stats (games, wins, average score, points by feature type), ratings and recent games.
- **Desktop sign-in:** better-auth's device-authorization (or loopback OAuth) flow opens the system browser and returns a session token stored in the OS keychain (macOS Keychain / libsecret).
- Account management screens (password, linked providers, deletion) **exist only on web**, and desktop links out to them.

### 6.6 Clocks
- Online: none / per-turn (e.g. 30 s) / chess-style total bank with increment. Server-authoritative.
- On timeout, the server auto-plays: it places the tile at a random legal spot (or Easy-AI's choice) and places no meeple. Three consecutive timeouts mark the player AFK, and a bot takes over.
- Ranked uses a fixed clock per queue.

### 6.7 Online rooms, matchmaking, spectating
- **Rooms:** created via tRPC and joined by `/r/{code}` link. The host sets the ruleset and bots, and can kick players. Rooms survive reconnects: on reconnect the client gets a state snapshot plus a move log tail.
- **Ranked:** queue → match → room with the locked ruleset. Glicko-2 updates when a game ends. Queues hold 3p and 4p FFA. Ratings use pairwise result decomposition (each finishing position treated as wins/losses against every other player), and ties count as draws.
- **Spectating:** read-only socket subscribers. Hidden information (hands, if the hand variant is on) is filtered server-side. Spectating is **live** for every game type, ranked included. (Base game + River + Abbot has no hidden information beyond the draw pile, so there is nothing to leak.)
- **Anti-cheat:** the server is authoritative. Clients send *intents* (`placeTile{x,y,rot}`, `placeMeeple{featureId}`), and the server validates them against the engine. The draw pile is server-side only.

### 6.8 Chat: emoji only
- An emoji reaction bar (a curated set of about 24 emoji, plus a few game-specific ones like 🏰 🐑 🛣️ ⛪). Reactions float up over the sender's avatar or score row, and are rate-limited.
- No free text, so no moderation is needed. Per-player mute, and a "hide all reactions" setting. Spectators can react, but their reactions are only shown to other spectators.

### 6.9 Replays
- Stored as `(engineVersion, ruleset, seed, moves[])` plus timestamps (about 2 KB per game). Re-simulated deterministically by the engine on demand.
- Viewer: play, pause, scrub, step, per-turn score delta, "what was the best move here?" analysis using Expert AI (P1).
- Engine-version pinning: old replays run on the engine version they were recorded with. WASM builds are versioned and kept.

### 6.10 AI
| Tier | Approach | Target time per move |
|---|---|---|
| Easy | Greedy one-ply with randomness, prefers placing meeples, ignores farmers | <50 ms |
| Medium | One-ply with heuristic evaluation (expected feature completion, meeple economy, farmer value) | <100 ms |
| Hard | MCTS (determinized over the remaining tile bag) with a heuristic rollout policy | ~1 s |
| Expert | MCTS + deeper search + opponent modelling, multi-threaded on desktop | ~2–3 s |

The AI is written in Zig in `core/ai`. It runs in a Web Worker (WASM) on web, on a background thread on desktop, and in the server worker pool for bots in online rooms.

## 7. Architecture

### 7.1 The shared Zig core (`packages/core`)
| Module | Responsibility |
|---|---|
| `engine/` | Pure, deterministic state machine. `State`, `Ruleset`, `Move`, `apply(state, move) → (state', events[])`, `legalMoves`, scoring, feature union-find. No allocation in the hot path (arena per game). Seeded PRNG (e.g. PCG/xoshiro) |
| `ai/` | Bots (§6.10) |
| `geo/` | Procedural meshes from tile feature graphs → vertex/index buffers + prop instance transforms (renderer-agnostic, emitted as flat typed arrays) |
| `anim/` | Turns engine `events[]` into a **presentation timeline** (tile rise, wall extrude, meeple hop, score popups) with keyed tracks. Both renderers play the same timeline, so effects behave identically on web and desktop |
| `proto/` | Wire message schema + binary codec (compact, versioned). A TS type generator emits `packages/protocol` |

**Bindings:**
- **WASM** (`wasm32-freestanding`): a C-ABI export surface consumed by `core-wasm` (TS), with zero-copy views into WASM memory for geometry buffers. Used by the web client (main thread + AI worker) and the Bun server.
- **Native:** imported as a Zig module by `apps/desktop`.

### 7.2 Web client
- Next.js pages: landing, lobby, room, game, replay, profile, settings, tutorial.
- Game canvas: `render-three` builds the scene from `core/geo` buffers and plays the `core/anim` timeline. React handles the HUD/overlays.
- Network: WebSocket to Elysia, with optimistic local validation by the same engine.

### 7.3 Server (Elysia on Bun, serverless on Vercel)
Vercel Functions now accept and hold WebSocket connections (public beta, June 2026). On the Bun runtime, `Bun.serve` with WebSocket handlers works as the function entrypoint. Each connection is pinned to one function instance until it closes or hits the function's maximum duration (300 s by default, 800 s on Pro). New connections can land on any instance, and there is no built-in broadcast across instances. The design follows from that:

- **tRPC (HTTP functions):** auth session, profile, room CRUD, matchmaking, replays list/fetch, stats.
- **WS `/game/:roomId`:** join/leave, intents, snapshots, events, clock ticks, emoji reactions. A socket subscribes to its room's Redis channel and forwards what it receives.
- **No in-memory rooms.** The authoritative state is the **move log in Postgres** plus a cached snapshot (`state blob + ply`) in Redis. To apply an intent, a server instance:
  1. loads the snapshot (and falls back to replaying the log from Postgres on a cache miss),
  2. validates and applies the intent with core-wasm,
  3. appends the move using **compare-and-set on `ply`**, enforced by a unique `(gameId, ply)` constraint, so two racing instances can't both commit,
  4. updates the snapshot and publishes the events to the room channel.
  Determinism makes this safe: any instance can rebuild any room.
- **Connection lifetime:** sockets are closed at the function's maximum duration (800 s on Pro). Clients reconnect without the player noticing, before the limit or on close, using `resume{gameId, lastPly}`. The server sends back the missing events, or a snapshot if too much was missed. The same path covers deploys and network drops.
- **Clocks without a long-lived process:** each turn stores `turnDeadline` in Redis and Postgres. Every instance holding a socket for that room sets a local timer. When it fires, the instance tries to claim the timeout with the same ply compare-and-set, so exactly one wins and auto-plays. If no sockets are connected, the next request touching the room applies any expired timeouts first (lazy enforcement). A 1-minute Vercel Cron sweeps abandoned rooms.
- **Bots:** a bot's move is computed in the function that committed the preceding move (Hard ~1 s, Expert ~2–3 s, within limits), then committed through the same compare-and-set path. If several bots play in a row, the function chains their moves or hands off with a self-invoked request.
- **Matchmaking:** Redis sorted sets per queue (3p, 4p). The ticket's own request (or a cron sweep) forms matches atomically with a Lua script, creates the room and notifies players over their lobby socket.
- **Fallback:** while the WebSocket feature is in beta, the transport is abstracted (`RoomTransport`). If Vercel's limits get in the way, the same stateless handlers can run behind a hosted pub/sub provider (Ably/Pusher), or the Elysia app can run in its existing Docker image with no code changes.

### 7.4 Desktop (zpui)
- **Native UI in zpui:** main menu, lobby/room, in-game HUD, settings, replay viewer, tutorial overlays. Assets (fonts, icons, audio, glTF, textures) are shared from `packages/assets`.
- **Native 3D:** a new zpui 3D module (`Surface3D` element + mesh/material/camera/light API) on Vulkan and Metal. It draws `core/geo` meshes and the glTF prop kit, and plays the `core/anim` timeline. Research and design: `docs/research/zpui-3d.md`.
- **Research result (`docs/research/zpui-3d.md`):** zui, upstream gpui and the gpui community have **no 3D** (no depth buffer, projection or mesh pipeline), so nothing can be ported. The plan is a native `Scene3D` subsystem in zpui. It renders offscreen (HDR, MSAA, depth), then tonemaps and composites the result through a new `viewport3d` scene primitive, the same pattern zpui already uses for vector paths. It is built on both Vulkan and Metal.
- **Fallback if native 3D slips:** embed a webview running `render-three` for the board only, with the zpui HUD staying native. This is a good fallback on macOS (WKWebView), but **weak on Linux** (zpui's WebKitGTK helper renders frames offscreen). That makes the native path the priority.
- **Networking:** a native WebSocket client using the same `core/proto` codec. Auth uses the device flow (§6.5).
- **Offline:** hot-seat, AI, tutorial and local replays with no network.
- **Packaging:** `.app` (universal, signed later) and a Linux tarball/AppImage. Uses zpui's existing `app-bundle`/`dist` build steps.

### 7.5 What is written once vs per platform
| Written once (shared) | Per platform |
|---|---|
| Rules, AI, procedural geometry, animation timeline, protocol (Zig) | Renderer: Three.js (web) / zpui 3D (desktop) |
| Assets: glTF, textures, audio, fonts | UI shell: React (web) / zpui (desktop) |
| Server, auth, DB, account pages (web) | Platform glue: keychain, file paths, packaging |

### 7.6 Data model (Drizzle, sketch)
`user`, `session`, `account` (better-auth) · `profile(userId, displayName, avatar, colorPref)` · `rating(userId, queue, mu, phi, sigma, games)` · `room(id, code, hostId, ruleset jsonb, status, createdAt)` · `game(id, roomId, engineVersion, seed, ruleset, startedAt, endedAt, ranked)` · `game_player(gameId, seat, userId?, botTier?, color, finalScore, breakdown jsonb)` · `move(gameId, ply, seat, payload bytea, at)`.

## 8. Non-functional requirements
- **Performance:** 60 fps at 1080p on an M1 or Intel Iris Xe with "Medium" settings and a full 84-tile board with props. 120 fps capable on desktop. Web time-to-interactive under 3 s on broadband, with the WASM core under 500 KB gzipped.
- **Latency:** intent → broadcast under 150 ms p95 within region.
- **Determinism:** golden test where 1000 seeded random games produce identical final hashes on WASM and native.
- **Reliability:** a room survives a server restart (rebuilt from the move log), and clients auto-reconnect.
- **Security:** server-authoritative play, rate limits on intents, better-auth sessions, no secrets in the client.
- **Testing:** Zig unit tests for every rule (citing rulebook refs), property tests (score conservation, meeple conservation), cross-target determinism tests, Playwright e2e for web flows, golden-image tests for both renderers (zpui already does golden images on lavapipe), bot-vs-bot soak tests.

## 9. Milestones
| # | Milestone | Exit criteria |
|---|---|---|
| M0 | Scaffold | Better-T-Stack monorepo, Zig core builds to wasm + native, CI |
| M1 | **Rules engine** | Base + River + Abbot + edition toggles, 100% of rule tests pass, determinism harness |
| M2 | Web 2D playable | Hot-seat + Easy/Medium AI in a minimal 2D board (validates engine UX) |
| M3 | Web 3D tabletop | `geo` + `anim` + `render-three`, dioramas, sound, Classic 2D toggle |
| M4 | Online | Accounts, invite rooms, reconnects, clocks, spectating, replays |
| M5 | Ranked + Hard/Expert AI | Glicko-2 queues, MCTS bots, tutorial |
| M6 | zpui 3D spike → module | Lit glTF in a zpui window on Vulkan + Metal, then the full board renderer |
| M7 | Desktop app | Native HUD/menus, offline modes, online via device-flow auth, packaging |
| M8 | Polish | Performance tiers, a11y, end-game cinematics |

M6 can run in parallel with M2–M5.

## 10. Success metrics (personal-scale)
- Zero known rules divergences from the rulebooks (tracked as bugs).
- A full 4-player online game with a mix of web and desktop players completes with no desyncs.
- Expert AI beats Medium in at least 75% of 1v1 games over 200 seeded runs.
- Frame-time p95 under 16.6 ms on the reference hardware.

## 11. Risks
| Risk | Mitigation |
|---|---|
| Native 3D in zpui is a large engine project | Spike first (M6). The webview `render-three` fallback inside zpui is the escape hatch |
| Two renderers drift visually | Geometry, animation timeline, materials and assets are shared data. Golden images are compared across renderers |
| Zig 0.17 churn / WASM toolchain | Pin the Zig version (same as zpui). Keep the WASM ABI small and C-like |
| Field-scoring edge cases | Union-find feature graph + exhaustive rulebook-derived fixtures |
| Vercel WebSockets are in beta; connections are capped at the function's maximum duration (800 s on Pro); no cross-instance broadcast | Stateless rooms (Postgres log + Redis snapshot/pub-sub), automatic client resume, `RoomTransport` abstraction with an Ably or Docker fallback |
| Concurrent intents land on different instances | Unique `(gameId, ply)` compare-and-set, and the deterministic engine rebuilds from the log |

## 12. Decisions log
| # | Question | Decision |
|---|---|---|
| 1 | The Abbot + gardens in v1? | **Yes**, on by default (§5.6) |
| 2 | Ranked queues | **3–4 player FFA** (separate 3p and 4p queues), no 1v1 ranked |
| 3 | Server hosting | **Serverless on Vercel** with WebSockets (§7.3), Neon Postgres, Redis via Vercel Marketplace |
| 4 | Chat | **Emoji reactions only** (§6.8) |
| 5 | Spectating ranked | **Live**, no delay |

### Still open
- Hand-of-3 variant: v1 or P1? (Currently P1, off by default.)
- Vercel plan: the PRD assumes **Pro** (800 s function duration, which reduces reconnect churn).
- Neon and Redis regions should sit next to the Vercel function region (e.g. `iad1`).

## 13. IP note
"Carcassonne" and its art are trademarks/copyrights of Hans im Glück / Z-Man Games. This project is **private, for personal use**, and all art assets are original (procedural plus our own models). Do not publish publicly or deploy publicly without rebranding.
