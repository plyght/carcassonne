# Cross-package contract

This is the shared contract that parallel workstreams build against. Change it only in a coordinated commit that updates every consumer. See `docs/PRD.md` for the product.

## Repo layout and ownership

| Path | Owner workstream | Notes |
|---|---|---|
| `packages/core/src/engine/tile.zig` | **contract** | Tile schema (ports, features, rotation). Shared by engine, ai, geo |
| `packages/core/src/engine/**` (rest) | engine | Rules, tile data, scoring, state, snapshots |
| `packages/core/src/ai/**` | ai | Bots (Easy→Expert) |
| `packages/core/src/geo/**`, `src/anim/**` | geo | Procedural 2D paths + 3D meshes, animation timeline |
| `packages/core/src/wasm.zig` | engine (others append exports in their own sections) | WASM ABI |
| `packages/core-wasm` | engine | TS loader + typed wrapper around `core.wasm` |
| `packages/protocol` | **contract** | TS types for everything crossing JSON boundaries (engine I/O, wire messages) |
| `packages/db`, `packages/api`, `packages/auth`, `apps/server` | server | Drizzle schema, tRPC, WebSockets, Queues |
| `apps/web`, `packages/ui`, `packages/render-*` | web | Next.js app, Classic Board 2D renderer, Three.js styles |
| `packages/assets` | web / geo | Style packs, glTF props, audio |
| `apps/desktop` | desktop | zpui app |

## Coordinates and orientation
- Board cells are integer `(x, y)`. **x grows east, y grows south** (screen convention). The first tile sits at `(0, 0)`.
- Sides: `N=0, E=1, S=2, W=3`. The neighbour across N is `(x, y-1)`.
- `rot` is the number of **clockwise quarter turns** (0–3) applied to the tile's canonical definition.
- Ports: see `packages/core/src/engine/tile.zig` (12 ports, clockwise from the NW corner of the north edge).

## Tile ids
- Base game: `"A"`…`"X"` (24 types, 72 tiles), using the standard community letter naming:
  - `D` is the start tile (`special = start`),
  - `C` is the 4-sided city with a pennant,
  - `B` is the plain cloister and `A` is the cloister with a road.
  - The engine owns the full table and documents it in `packages/core/src/engine/tiles_base.zig`.
- River: `"R1"`…`"R12"` (`R1` = spring, `R12` = lake).
- Gardens (3rd edition, Abbot) are `garden` features on the base tiles that carry them.

Every feature on a placed tile is addressed by its **local index** into `TileDef.features` (canonical order, independent of rotation).

## Engine JSON I/O (mirrored by `packages/protocol/src/engine.ts`)
One turn = one `Move`: place the drawn tile, then do one figure action.

```jsonc
// Ruleset
{ "fieldEdition": 3, "river": true, "abbot": true, "handSize": 1 }
// Move
{ "x": 1, "y": 0, "rot": 2, "figure": { "type": "meeple", "feature": 3 } }
// figure: null | {type:"meeple",feature} | {type:"abbot",feature} | {type:"recallAbbot", x, y}
```

Events are emitted by `apply` in order (`type` discriminator):
- `turnStarted {player, tile}`
- `tileDiscarded {tile}`
- `tilePlaced {player, x, y, rot, tile}`
- `figurePlaced {player, x, y, feature, figure}`
- `featureScored {kind, cells:[[x,y]...], winners:[player...], points, returned:[{player,x,y,feature,figure}], final:boolean}`
- `abbotRecalled {player, x, y, points}`
- `gameEnded {scores:[...], breakdown:[{road,city,cloister,garden,field}...]}`

The public game view (`GameView`) is the JSON the UI renders. It contains:
- board tiles with owners and figures,
- per-player score, meeples left and abbot status,
- current player and current tile,
- remaining tile counts by id (never the deck order),
- `ply` and `status`.

## WASM ABI (`core.wasm`, `wasm32-freestanding`)
- Memory: `core_alloc(len) -> ptr`, `core_free(ptr, len)`.
- **JSON-returning functions** return a pointer to `[u32 little-endian length][utf8 bytes]`. The caller frees it with `core_free(ptr, 4 + length)`.
- Handles are `u32`; `0` means error.
- Engine exports (owned by the engine workstream):
  - `game_new(ruleset_ptr, ruleset_len, seed_lo, seed_hi, players) -> handle`
  - `game_free(handle)`
  - `game_apply(handle, move_ptr, move_len) -> json {ok:true, events:[...]} | {ok:false, error:"..."}`
  - `game_view(handle) -> json GameView`
  - `game_legal_placements(handle) -> json [{x,y,rot}]`
  - `game_legal_figures(handle, x, y, rot) -> json [{type, feature}]`
  - `game_snapshot(handle) -> json` / `game_restore(ptr, len) -> handle` (full state including the deck; server only)
  - `game_hash(handle) -> u64`, used by the determinism tests
- AI export: `ai_choose(handle, tier, budget_ms, seed_lo, seed_hi) -> json Move`
- Geo exports (binary, owned by the geo workstream): documented in `packages/core/src/geo/README.md`.

## Determinism
- The PRNG and shuffle live in the engine; there is no other source of randomness.
- `(engineVersion, ruleset, seed, players, moves[])` reproduces the game bit-for-bit on WASM and native.
- `game_hash` is used by the cross-target test.

## Wire protocol (client ↔ server WebSocket, `packages/protocol/src/wire.ts`)
- **Client → server:**
  - `hello {gameId, lastPly}`
  - `intent {gameId, ply, move}`
  - `react {gameId, emoji}`
  - `ping`
- **Server → client:**
  - `welcome {view, ply}`
  - `events {gameId, fromPly, toPly, events}`
  - `rejected {ply, error}`
  - `reaction {player, emoji}`
  - `presence {players:[...]}`
  - `clock {gameId, ply, deadline}`
  - `pong`
- All messages are JSON objects with a `t` discriminator.

## Toolchain
- **Zig 0.17.0** (`/usr/local/bin/zig`). From `packages/core`:
  - `zig build test` runs the tests,
  - `zig build wasm` writes `zig-out/bin/core.wasm`.
- **Bun 1.3**, Turborepo: `bun run check-types` and `bun run build` at the root.
