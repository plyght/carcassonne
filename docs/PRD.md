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

- **Web**: Next.js and Three.js. The whole backend runs on **Vercel only** (free Hobby plan).
- **Desktop**: native macOS and Linux apps built on **zpui** (our Zig port of gpui), with a new native 3D renderer.

It ships with **several complete visual styles**, each player picks their own and can switch live (§6.3): realistic Tabletop, Classic 2D top-down, Cartoon, Living Diorama, Storybook and Blueprint, each with top-down, tabletop, orbit and cinematic cameras. The default is a **realistic tabletop that comes to life**: a wooden table under warm light, cardboard tiles and wooden meeples. As each tile is placed it "pops" into a living 3D diorama: city walls rise, the cloister bell swings, sheep graze, carts roll down finished roads. When the camera pulls back, the board reads as a clean map.

Play modes: online multiplayer (invite rooms, ranked play, spectating), local hot-seat, AI opponents (Easy→Expert), replays, and a tutorial.

**Write the game once.** The rules, the AI, procedural tile geometry, the animation timeline and the network protocol all live in a single **Zig core**. That core compiles to WASM for the browser and the Bun server, and to native code for desktop. The renderer and the UI shell are the only parts built per platform.

## 2. Goals and non-goals

### Goals
1. **Rules parity.** Every rule in the base game and River rulebooks is implemented and covered by tests, including edge cases (unplaceable tiles, meeple-sharing ties, field and city adjacency, River U-turn restriction).
2. **One rules engine.** The same Zig engine runs on the server (authoritative), in the browser (prediction, offline AI) and on desktop. Games are deterministic, so `(seed, ruleset, moves)` always reproduces the same game.
3. **"Cooler than the box."** Every style from realistic tabletop to cartoon to classic 2D, with live dioramas, scoring cinematics and ambient sound.
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
  --db-setup neon --package-manager bun --git --web-deploy vercel --server-deploy docker \
  --install --addons turborepo --examples none
```

> The scaffold's `--server-deploy docker` output is not used. The Elysia server deploys to **Vercel** alongside the web app (§7.3).

| Layer | Tech |
|---|---|
| Monorepo | Turborepo + Bun workspaces |
| Web app | Next.js (App Router), React, Three.js (WebGPU renderer with WebGL2 fallback), deployed on Vercel |
| API | Elysia on Bun + tRPC, **serverless on Vercel Hobby (free)**. Request/response only: every game action is a short HTTP call. No long-lived server process or held sockets (§7.3) |
| Realtime push | **Vercel Functions WebSockets** with Postgres `LISTEN/NOTIFY` fan-out, and a CDN-cached polling fallback (§7.3) |
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

### 6.3 Visual styles: every look, switchable live
The board can be shown in **several complete visual styles**, and each player picks their own. Style is purely client-side, so in the same online game one player can see the realistic tabletop while another plays on the flat classic board. Styles switch live, mid-game, with no reload. The settings show a preview carousel.

Two independent controls:
- **Style:** how things look (materials, shading, props, effects, sound palette).
- **Camera:** how you look at it. **Top-down** (orthographic map view), **Tabletop** (tilted perspective, the default for 3D styles), **Free orbit**, and **Cinematic** (follows the action and frames scoring moments). Every style works with every camera. A 2D style simply locks to top-down.

| Style | Look | Ships in |
|---|---|---|
| **Tabletop (realistic)** | PBR wooden table, linen cardboard tiles with bevelled edges and printed tops, wooden meeples with grain and soft contact shadows, warm key light + HDR environment. The **life layer** rises out of each tile (below) | M3 (default) |
| **Classic Board (2D top-down)** | Crisp flat vector tiles in the spirit of the printed game: clean outlines, parchment fields, stone-grey cities with pennant shields, flat meeple tokens. Fastest, clearest, best for competitive play and low-end hardware | M2–M3 |
| **Cartoon / Toon** | Saturated colours, cel shading with ink outlines, chunky rounded props, squash-and-stretch meeples, bouncy tile drops, comic "POW" score pops | M3–M5 |
| **Living Diorama (miniature)** | Tilt-shift miniature world (Townscaper-like): soft pastel palette, strong depth of field, animated villagers and sheep, day/night and weather | M8 |
| **Storybook / Painterly** | Watercolour paper texture, hand-inked edges, painterly post-processing, illustrated score cards | M8 (stretch) |
| **Blueprint / High-contrast** | Minimal line art on a dark grid, maximum legibility. Doubles as the accessibility style | M8 |

**The life layer** (Tabletop, Toon, Diorama, each in its own art direction). Each placed tile rises out of its printed art into relief:
- **Cities:** walls and towers extrude along the city edges. Completed cities raise banners in the owner's colour and light their windows at dusk.
- **Roads:** dirt with ruts. Completed roads get a cart that drives the full length.
- **Cloisters and gardens:** a chapel with a swinging bell, and a garden with a fountain. When completed, monks gather.
- **Fields:** wind-swept grass, instanced sheep and cows, crops by region.
- **River:** flowing water, a mill wheel, ducks.

**How styles stay cheap to add (write once):**
- **Shared geometry.** `core/geo` (Zig) turns each tile's feature graph into *style-agnostic* data: 3D meshes (wall/road splines, field polygons, terrain height) **and** 2D vector paths (the same regions flattened). The 3D styles use the meshes. Classic Board and Blueprint use the 2D paths, which zpui draws natively with its existing path renderer and the web draws with Three.js orthographic/SVG. So **Classic Board works on desktop before native 3D lands**.
- **A style pack is data, not code.** `packages/assets/styles/<style>/style.json` (the same file on web and desktop) defines:
  - the material set: PBR, toon ramp + outline, unlit flat, or watercolour,
  - the prop kit variant (glTF per style, shared skeletons and animation names),
  - a palette per player colour (colour-blind safe),
  - the post-FX chain: tonemap, SSAO, DOF/tilt-shift, outline, paper grain,
  - animation intensity (realistic ease, cartoon overshoot, reduced motion),
  - the ambience and SFX palette.
- **Shared animation.** The `core/anim` timeline is the same for every style. Styles only change easing and intensity curves.
- **Shading models.** There are a small, fixed set, implemented on both renderers:
  - `pbr`, `toon` (ramp + inverted-hull outline), `flat` (unlit), and `paint` (watercolour post).
  - Three.js: built-in materials plus custom shader material.
  - zpui: GLSL to SPIR-V for Vulkan, SPIRV-Cross to MSL for Metal.
  - Per-style golden images on both renderers catch visual drift.

**Shared across styles:**
- **Scoring moments:** the feature outline pulses, points pop up in the style's own way (coins, comic bursts, ink stamps), and the meeple hops home.
- **Performance tiers:** Low, Medium and High within each style, auto-detected with a manual override. Classic Board is the guaranteed fallback.
- **Accessibility:** a colour-blind-safe meeple palette plus a shape/pattern marker on every meeple in every style, reduced-motion mode, full keyboard play, scalable UI text, and the Blueprint high-contrast style.

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

The AI is written in Zig in `core/ai`. It runs in a Web Worker (WASM) on web and on a background thread on desktop. For bots in online rooms it runs **server-side in a Vercel Queues consumer**, with think time capped to fit the free CPU budget (§7.3).

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

### 7.3 Server: Vercel only, free tier (Hobby)
**Constraint:** everything runs on **Vercel**. No separate providers, accounts or bills. The only part not built by Vercel is Postgres. Vercel no longer has its own database: "Vercel Postgres" moved to **Neon through the Vercel Marketplace**, which is provisioned from the Vercel dashboard, **billed through Vercel**, and whose environment variables are injected automatically. So it stays inside Vercel.

| Need | Vercel product |
|---|---|
| Web app, API, tRPC | **Vercel Functions** (Next.js + Elysia on the Bun runtime, `export default app`) |
| Real-time push | **Vercel Functions WebSockets** (`Bun.serve` WebSocket handlers; public beta) |
| Cross-instance fan-out | **Postgres `LISTEN/NOTIFY`** on the Marketplace Neon DB (direct, unpooled connection) |
| Source of truth, auth, ratings | **Postgres (Neon via Vercel Marketplace)** + Drizzle + better-auth |
| Turn clocks, server bots, matchmaking retries | **Vercel Queues** (delayed messages, push consumers; 1M operations/month free) |
| Avatars, replay exports, desktop app downloads | **Vercel Blob** |
| Feature flags, kill switches (e.g. "force polling") | **Edge Config** |
| Usage alerts | Vercel usage dashboard + notifications, plus our own counters (below) |

**Hobby limits that drive the design.** Going over a limit **pauses the deployment** (there is no overage billing), so we stay well under.
| Limit | Value | Consequence |
|---|---|---|
| Function max duration | **300 s** (also caps WebSocket lifetime) | Clients reconnect without the player noticing every ~4.5 min |
| Memory | Fixed **2 GB**; 360 GB-hrs/month = **180 instance-hours** | An open socket keeps its instance billed, but fluid compute **puts many sockets on one instance**. Sockets only stay open during live play |
| Active CPU | **4 h/month** (idle sockets cost none) | Moves are about 1 ms. Server bots are capped (below) |
| Invocations / edge requests | 1M each | Polling fallback uses CDN-cached, immutable move URLs |
| Cron | Once/day | Clocks use Queues instead |

**How a move flows**
1. The client sends `intent{gameId, ply, ...}` over its WebSocket. Desktop and web use the same protocol; desktop uses a native Zig WebSocket client.
2. The function loads `(seed, ruleset, moves[])` from Postgres and replays it with core-wasm (well under 1 ms), then validates the intent.
3. It inserts the move with a unique `(gameId, ply)` key, which acts as compare-and-set: if two instances race, one wins.
4. In the same transaction it runs `NOTIFY game_<id>, '<ply>'`.
5. Every instance holding sockets for that game has `LISTEN game_<id>` on one shared direct connection. It hears the notification and pushes the new move(s) to its sockets.
6. It enqueues the next turn's **Queues delayed message** (the clock), plus a bot job if the next seat is a bot.

**Connection lifecycle and reconnect.**
- Sockets open only on lobby, queue or game screens.
- Hidden tabs disconnect after 60 s and resume on focus.
- At about 280 s the client proactively opens a new socket (`resume{gameId, lastPly}`) before closing the old one, so nothing is missed. The server sends back the moves the client missed.
- Presence ("connected/AFK") comes from socket join/leave plus a `presence` table with a 30 s TTL heartbeat over the open socket.

**Turn clocks (Vercel Queues).** Each committed move enqueues one delayed message `{gameId, ply}` due at `turnDeadline`.
- When it fires, the consumer does nothing if the game has already moved past that ply. Otherwise it auto-plays (Easy-AI tile, no meeple) through the same compare-and-set path.
- Clients only *display* the countdown.
- This costs about 3–4 operations per turn.

**Bots (Vercel Queues).**
- When the turn passes to a bot seat, a bot job runs `core/ai` in a consumer function and commits the move.
- Think time is capped at about **1 s**, using iteration-limited MCTS.
- A monthly bot-CPU counter in Postgres drops bots to Medium at about **2.5 CPU-h**, so the account never pauses.
- Offline/local games get full-strength Expert on the client.
- **Ranked games have no bots.**

**Matchmaking (3p/4p).**
- Players join a `queue_ticket` table.
- Each `joinQueue` tries to form a match in one transaction (`SELECT … FOR UPDATE SKIP LOCKED`). If no match forms, it enqueues a delayed Queues retry after 15 s.
- When a match forms, `NOTIFY user_<id>` tells each player's lobby socket.

**Emoji reactions.** These go over the socket to the server, which rate-limits them per user and relays them with `NOTIFY game_<id>_react`. They are not persisted.

**Guard rails (memory is the tight resource).**
- An `instance_usage` table records each instance's live time (start, then a heartbeat every 60 s) to estimate GB-hrs.
- At **70%** of the monthly allowance, an **Edge Config** flag switches *new* connections to **polling mode**:
  - clients fetch `GET /g/:id/ply` every 2 s, a tiny response cached on the CDN for 1 s, so all clients in a game share about one function call per second,
  - and `GET /g/:id/m/:ply`, which is **immutable** and cached on the CDN forever.
- Polling uses almost no provisioned memory.
- At **90%**, new online games are paused with a friendly banner. Offline, hot-seat and AI play always work.

**Monthly free-tier budget (estimate: ~100 games × 4 players, about 75 game-hours)**
| Resource | Estimate | Hobby limit |
|---|---|---|
| Provisioned memory | ~150–220 GB-hrs (sockets share 1–2 instances during play) + ~20 short requests | 360 GB-hrs |
| Active CPU | ~0.2 h (moves, notify fan-out) + ≤2.5 h (bots, capped) | 4 h |
| Invocations | ~60K (moves, reconnects every ~4.5 min, queue consumers) | 1M |
| Vercel Queues | ~30K operations | 1M |
| Neon (Marketplace) | ~25 CU-hours (awake during play for LISTEN) | 100 CU-hours |

**Honest capacity.** About **100 game-hours a month** fit comfortably on WebSockets. Beyond that, the automatic switch to polling keeps the site within the free tier (~300+ game-hours). Heavier use means moving to Vercel Pro, which needs no architecture change: the 800 s duration only means fewer reconnects.

**Beta risk.** Vercel WebSockets and Queues are in public beta. Transport (`RoomTransport`: WebSocket | polling) and scheduling (`Scheduler`) are interfaces. **Polling mode is already a complete Vercel-only fallback** if WebSockets misbehave.

### 7.4 Desktop (zpui)
- **Native UI in zpui:** main menu, lobby/room, in-game HUD, settings, replay viewer, tutorial overlays. Assets (fonts, icons, audio, glTF, textures) are shared from `packages/assets`.
- **Native 3D:** a new zpui 3D module (`Surface3D` element + mesh/material/camera/light API) on Vulkan and Metal. It draws `core/geo` meshes and the glTF prop kit, and plays the `core/anim` timeline. Research and design: `docs/research/zpui-3d.md`.
- **Research result (`docs/research/zpui-3d.md`):** zui, upstream gpui and the gpui community have **no 3D** (no depth buffer, projection or mesh pipeline), so nothing can be ported. The plan is a native `Scene3D` subsystem in zpui. It renders offscreen (HDR, MSAA, depth), then tonemaps and composites the result through a new `viewport3d` scene primitive, the same pattern zpui already uses for vector paths. It is built on both Vulkan and Metal. **A Vulkan spike already works** (lavapipe, zero validation errors): a lit cube and meeple on a table plane composited under a blurred HUD strip, with a new 3D golden image test (`docs/research/zpui-3d-spike.png`, patch `docs/research/zpui-3d-spike.patch`). Metal, glTF loading, shadows and the window element are next. Estimate for phases 1–4: about a quarter of focused work, plus art.
- **Fallback if native 3D slips:** embed a webview running `render-three` for the board only, with the zpui HUD staying native. This is a good fallback on macOS (WKWebView), but **weak on Linux** (zpui's WebKitGTK helper renders frames offscreen). That makes the native path the priority.
- **Networking:** the same WebSocket protocol as web (a native Zig WebSocket client, `core/proto` messages) for play, and tRPC over HTTP (a small Zig JSON client) for everything else. Polling mode is supported too. Auth uses the device flow (§6.5).
- **Offline:** hot-seat, AI, tutorial and local replays with no network.
- **Packaging:** `.app` (universal, signed later) and a Linux tarball/AppImage. Uses zpui's existing `app-bundle`/`dist` build steps.

### 7.5 What is written once vs per platform
| Written once (shared) | Per platform |
|---|---|
| Rules, AI, procedural geometry, animation timeline, protocol (Zig) | Renderer: Three.js (web) / zpui 3D (desktop) |
| Assets: glTF, textures, audio, fonts | UI shell: React (web) / zpui (desktop) |
| Server, auth, DB, account pages (web) | Platform glue: keychain, file paths, packaging |

### 7.6 Data model (Drizzle, sketch)
`user`, `session`, `account` (better-auth) · `profile(userId, displayName, avatar, colorPref)` · `rating(userId, queue, mu, phi, sigma, games)` · `room(id, code, hostId, ruleset jsonb, status, createdAt)` · `game(id, roomId, engineVersion, seed, ruleset, startedAt, endedAt, ranked, turnDeadline, botHostSeat)` · `game_player(gameId, seat, userId?, botTier?, color, finalScore, breakdown jsonb)` · `move(gameId, ply, seat, payload bytea, at)` (PK `(gameId, ply)`) · `queue_ticket(id, userId, queue, rating, createdAt)`.

## 8. Non-functional requirements
- **Performance:** 60 fps at 1080p on an M1 or Intel Iris Xe with "Medium" settings and a full 84-tile board with props. 120 fps capable on desktop. Web time-to-interactive under 3 s on broadband, with the WASM core under 500 KB gzipped.
- **Latency:** intent → broadcast under 200 ms p95 within region on WebSockets (under 2.5 s in polling mode). The local engine validates moves first, so the UI responds instantly.
- **Free-tier budget:** our own usage counters (instance live time, bot CPU, queue operations) plus the Vercel usage dashboard, with automatic degradation at 70% and 90% (§7.3), since going over a Hobby limit pauses the site.
- **Determinism:** golden test where 1000 seeded random games produce identical final hashes on WASM and native.
- **Reliability:** a room survives a server restart (rebuilt from the move log), and clients auto-reconnect.
- **Security:** server-authoritative play, rate limits on intents, better-auth sessions, no secrets in the client.
- **Testing:** Zig unit tests for every rule (citing rulebook refs), property tests (score conservation, meeple conservation), cross-target determinism tests, Playwright e2e for web flows, golden-image tests for both renderers (zpui already does golden images on lavapipe), bot-vs-bot soak tests.

## 9. Milestones
| # | Milestone | Exit criteria |
|---|---|---|
| M0 | Scaffold | Better-T-Stack monorepo, Zig core builds to wasm + native, CI |
| M1 | **Rules engine** | Base + River + Abbot + edition toggles, 100% of rule tests pass, determinism harness |
| M2 | Web 2D playable | Hot-seat + Easy/Medium AI on the **Classic Board** style (`core/geo` 2D paths), validating engine UX |
| M3 | Web 3D + style system | `geo` + `anim` + `render-three`, style-pack loader, **Tabletop** (default) + **Cartoon** styles, camera modes, life layer, sound |
| M4 | Online | Accounts, invite rooms, reconnects, clocks, spectating, replays |
| M5 | Ranked + Hard/Expert AI | Glicko-2 queues, MCTS bots, tutorial |
| M6 | zpui 3D spike → module | Lit glTF in a zpui window on Vulkan + Metal, then the full board renderer |
| M7 | Desktop app | Native HUD/menus, **Classic Board on zpui paths first**, then the 3D styles, offline modes, online via device-flow auth, packaging (downloads on Vercel Blob) |
| M8 | Polish + more styles | **Living Diorama**, **Blueprint/High-contrast**, Storybook (stretch), performance tiers, a11y, end-game cinematics |

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
| Hobby limits pause the whole deployment when exceeded | Sockets only during live play, bot CPU cap, instance-time counter, automatic polling mode at 70% and online pause at 90% |
| Many visual styles multiply art and shader work | Styles are data packs over shared geometry and animation. A fixed set of 4 shading models. Per-style golden images. Styles beyond Tabletop, Classic and Cartoon are M8 |
| Concurrent intents land on different instances | Unique `(gameId, ply)` compare-and-set, and the deterministic engine rebuilds state from the log on every call |
| Server bots exhausting the 4 CPU-hour Hobby budget | 1 s think-time cap, monthly bot-CPU counter with a Medium fallback at about 2.5 h, usage alerts |
| Vercel Queues is in public beta; Elysia on the Bun runtime is beta | Queues sits behind a `Scheduler` interface with QStash as the fallback. Elysia can run on the Node runtime on Vercel if Bun has problems |

## 12. Decisions log
| # | Question | Decision |
|---|---|---|
| 1 | The Abbot + gardens in v1? | **Yes**, on by default (§5.6) |
| 2 | Ranked queues | **3–4 player FFA** (separate 3p and 4p queues), no 1v1 ranked |
| 3 | Server hosting | **Vercel only, Hobby (free)**: Functions (HTTP + WebSockets), Queues, Blob, Edge Config, and Postgres via the Vercel Marketplace (Neon, billed by Vercel). Fan-out via Postgres LISTEN/NOTIFY. No Ably or Redis (§7.3) |
| 4 | Chat | **Emoji reactions only** (§6.8) |
| 5 | Spectating ranked | **Live**, no delay |
| 6 | Visual design | **All styles**, chosen per player and switchable live: Tabletop, Classic 2D, Cartoon, Living Diorama, Storybook, Blueprint × camera modes (§6.3) |

### Still open
- Hand-of-3 variant: v1 or P1? (Currently P1, off by default.)
- Region: default `iad1` (Vercel) + `us-east-1` (Marketplace Postgres), unless you prefer elsewhere.

## 13. IP note
"Carcassonne" and its art are trademarks/copyrights of Hans im Glück / Z-Man Games. This project is **private, for personal use**, and all art assets are original (procedural plus our own models). Do not publish publicly or deploy publicly without rebranding.
