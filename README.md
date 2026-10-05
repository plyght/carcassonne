# carcassonne

This project was created with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack), a modern TypeScript stack that combines Next.js, Elysia, TRPC, and more.

## Features

- **TypeScript** - For type safety and improved developer experience
- **Next.js** - Full-stack React framework
- **TailwindCSS** - Utility-first CSS for rapid UI development
- **Shared UI package** - shadcn/ui primitives live in `packages/ui`
- **Elysia** - Type-safe, high-performance framework
- **tRPC** - End-to-end type-safe APIs
- **Bun** - Runtime environment
- **Drizzle** - TypeScript-first ORM
- **PostgreSQL** - Database engine
- **Authentication** - Better-Auth
- **Turborepo** - Optimized monorepo build system

## Getting Started

First, install the dependencies:

```bash
bun install
```

## Database Setup

This project uses PostgreSQL with Drizzle ORM (Neon via the Vercel Marketplace in production).

1. Start a local Postgres 16 and put its URL in `apps/server/.env` (`DATABASE_URL=postgresql://postgres:password@localhost:5432/postgres`).
2. Apply the migrations and seed dev data:

```bash
bun run db:migrate        # drizzle-kit migrate (packages/db/src/migrations)
bun run db:seed           # 4 dev accounts (password "carcassonne-dev"), a lobby room, a game vs bots
```

After changing `packages/db/src/schema/*`, run `bun run db:generate` and commit the new migration.

Then, run the development server:

```bash
bun run dev
```

Open [http://localhost:3001](http://localhost:3001) in your browser to see the web application.
The API is running at [http://localhost:3000](http://localhost:3000) (WebSocket at `ws://localhost:3000/ws`).

## Run locally

Everything (Postgres, API server, web app, the online e2e test) runs on one machine.

1. **Postgres 16.** Start it (`service postgresql start` on the dev container) so that
   `postgresql://postgres:password@localhost:5432/postgres` works.
2. **Env files** (gitignored; schemas in `apps/*/.env.schema`):

   ```bash
   # apps/server/.env
   BETTER_AUTH_SECRET=<32+ random chars>
   BETTER_AUTH_URL=http://localhost:3000
   CORS_ORIGIN=http://localhost:3001
   DATABASE_URL=postgresql://postgres:password@localhost:5432/postgres
   # optional: FORCE_POLLING=true, SCHEDULER=local (default off Vercel), ENGINE=wasm (default)

   # apps/web/.env
   NEXT_PUBLIC_SERVER_URL=http://localhost:3000
   ```

3. **Install and migrate:** `bun install`, then `cd packages/db && bunx varlock run -- bun src/migrate.ts`
   (or `bun run db:migrate` with a TTY). Optional: `bun run db:seed`.
4. **Run:** `bun run dev` starts the API server on :3000 (HTTP, tRPC, `/ws`, in-process scheduler for
   clocks and bots) and the web app on :3001. Local games (hot-seat, vs AI) need no server at all.
5. **Engine:** the web app loads `packages/core-wasm/core.wasm` twice from one cached URL: in a Web
   Worker for local games (`apps/web/src/workers/engine.worker.ts`) and on the main thread for the tile
   catalog, core-geo tile/meeple art and online legal moves (`apps/web/src/lib/core.tsx`). After changing
   Zig code: `cd packages/core && zig build test && zig build wasm && cp zig-out/bin/core.wasm ../core-wasm/core.wasm`.
6. **End-to-end test** (Playwright, real engine, two browsers): with Postgres up and the web app running
   on :3001 (`bun run dev:web`, or `next build && next start -p 3001` with `NEXT_PUBLIC_SERVER_URL` set),
   run `cd apps/web && bun run e2e`. The script starts the API server on :3000 itself (stop your own
   first), then covers: sign-up and guest join of an invite room by code, 12 turns over WebSockets with
   both clients in sync, reload and resume, an emoji reaction, a game under `FORCE_POLLING=true`, and a
   bot seat played by the queue consumer. Screenshots land in `docs/screenshots/online-*.png`.
   `bun run e2e:local` smoke-tests a local vs-AI River game. Chromium comes from `/opt/pw-browsers`
   (`CHROMIUM_PATH` overrides it); never run `playwright install`.

## Server (apps/server)

- `api/server.ts` calls `Bun.serve({ fetch, websocket })` once at module startup. This is both the Vercel
  Function entrypoint and the local dev server (`bun run dev:server`), so local dev runs the same code.
  `fetch` upgrades `/ws` to a raw Bun WebSocket (`GameHub`, protocol in `packages/protocol/src/wire.ts`)
  and hands every other request to the Elysia app (`src/http.ts`: better-auth, tRPC, polling endpoints).
- Moves: stateless replay + compare-and-set insert on `move (game_id, ply)` + `NOTIFY game_<id>` in the
  same transaction; every instance holding sockets LISTENs on one direct connection and pushes new moves.
- Clocks, server bots and matchmaking retries are Vercel Queues topics (`clock-timeout`, `bot-move`,
  `matchmaking-retry`), consumed by `api/queues/*.ts`. Locally (`SCHEDULER=local`, the default off Vercel)
  an in-process scheduler calls the same handlers.
- Polling fallback: `GET /g/:id/ply` (`s-maxage=1`) and `GET /g/:id/m/:ply` (immutable). Force it with
  `FORCE_POLLING=true` or the Edge Config key `forcePolling`; it also turns on automatically at 70% of
  the estimated monthly memory allowance.
- Engine: `ENGINE=wasm` (default: the committed `packages/core-wasm/core.wasm`) or `ENGINE=fake` (test stand-in).
  The binding point is `apps/server/src/engine.ts`.
- Env vars are documented in `apps/server/.env.schema`.
- Tests: `bun run test` (needs the local Postgres; creates `carcassonne_test_*` databases).

## UI Customization

React web apps in this stack share shadcn/ui primitives through `packages/ui`.

- Change design tokens and global styles in `packages/ui/src/styles/globals.css`
- Update shared primitives in `packages/ui/src/components/*`
- Adjust shadcn aliases or style config in `packages/ui/components.json` and `apps/web/components.json`

### Add more shared components

Run this from the project root to add more primitives to the shared UI package:

```bash
npx shadcn@latest add accordion dialog popover sheet table -c packages/ui
```

Import shared components like this:

```tsx
import { Button } from "@carcassonne/ui/components/button";
```

### Add app-specific blocks

If you want to add app-specific blocks instead of shared primitives, run the shadcn CLI from `apps/web`.

## Environment Configuration

Each app owns its environment schema in `.env.schema`. Varlock generates `src/env.ts` during installation; run `bun run env:generate` after changing a schema. Commit schemas, and keep secrets in ignored env files or your deployment platform.

Import the generated `ENV` accessor in application code. Shared database and auth packages receive configuration or initialized clients from the application. See [Varlock's monorepo guide](https://varlock.dev/guides/monorepos/).

Bun's automatic env loading is disabled in `bunfig.toml`; the framework integration or server bootstrap loads Varlock. Node deployments must include Varlock and its dependencies alongside the app schema.

Run standalone Node/Bun tools that use Varlock from the owning app directory so they load that app's schema and env files. `env:generate` only generates TypeScript files; it does not initialize environment values in a subsequent command.

## Deployment (Vercel only)

Everything deploys to Vercel (Hobby) from the root `vercel.json` as Vercel Services:

| Service | Root | What |
|---|---|---|
| `web` | `apps/web` | Next.js app (catch-all route) |
| `server` | `apps/server` | Bun runtime function `api/server.ts` (HTTP + WebSockets, `maxDuration` 300 s); the build step applies DB migrations |
| `clock-timeout`, `bot-move`, `matchmaking-retry` | `apps/server` | Private Vercel Queues push consumers (`queue/v2beta` triggers), no public route |

Public routes `/ws`, `/trpc/*`, `/api/auth/*`, `/g/*`, `/config`, `/healthz` go to `server`; everything else goes to `web`.
Set `NEXT_PUBLIC_SERVER_URL` to the deployment origin (same domain).

- Link the project first: bun run deploy:setup
- Connect Neon from the Vercel Marketplace (injects `DATABASE_URL` and `DATABASE_URL_UNPOOLED`)
- Local build of the deploy output (no upload): bun run build:vercel
- Local Vercel dev: bun run dev:vercel
- Sync preview env: bun run env:preview
- Sync production env: bun run env:production
- Dry-run check (no upload): bun run deploy:check
- Preview deploy: bun run deploy
- Production deploy: bun run deploy:prod
  Vercel Services share project environment variables, but deploys do not upload local `.env` files automatically. Link the project with `vercel link`, then run the env sync command before your first deploy (otherwise the deployment starts with no env vars), or pass one-off envs with `vercel deploy -e KEY=value`.
  Pass Vercel CLI flags to the env sync command directly, for example: `bun run env:production --scope your-team`.

For more details, see the guide on [Deploying to Vercel](https://www.better-t-stack.dev/docs/guides/vercel).

## Project Structure

```
carcassonne/
├── apps/
│   ├── web/         # Frontend application (Next.js)
│   └── server/      # Bun.serve entry (WebSockets + Elysia/tRPC), Vercel Queues consumers
├── packages/
│   ├── ui/          # Shared shadcn/ui components and styles
│   ├── api/         # API layer / business logic
│   ├── auth/        # Authentication configuration & logic
│   └── db/          # Database schema & queries
```

## Available Scripts

- `bun run dev`: Start all applications in development mode
- `bun run build`: Build all applications
- `bun run dev:web`: Start only the web application
- `bun run dev:server`: Start only the server
- `bun run check-types`: Check TypeScript types across all apps
- `bun run db:push`: Push schema changes to database
- `bun run db:generate`: Generate database client/types
- `bun run db:migrate`: Run database migrations
- `bun run db:studio`: Open database studio UI
- `bun run db:seed`: Seed dev accounts, a room and a game
- `bun run test`: Run the test suites (server tests need local Postgres)
- `bun run build:vercel`: Build the Vercel output locally
- `bun run deploy:setup`: Link this repo to a Vercel project (first-time setup)
- `bun run dev:vercel`: Run the Vercel Services dev environment locally
- `bun run env:preview`: Sync local env files to the Vercel preview environment
- `bun run env:production`: Sync local env files to the Vercel production environment
- `bun run deploy`: Create a Vercel preview deployment
- `bun run deploy:prod`: Deploy to Vercel production
- `bun run deploy:check`: Dry-run a deploy to preview framework detection and included files without uploading

## Better Auth Schema Generation

After changing auth plugins or schema options, run `bun run auth:generate` from the project root. The script runs the Better Auth CLI through `varlock run` from the owning app directory, loading the auth instance from `src/services.ts`. Review the schema changes, then use your ORM's migration workflow to apply them.
