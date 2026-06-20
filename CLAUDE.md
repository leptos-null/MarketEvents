# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Market Events is a Discord bot that reminds a channel about upcoming earnings reports, running on **Cloudflare Workers** (TypeScript, Bun, wrangler). See `AGENTS.md` for the rule about retrieving current Cloudflare docs before any Workers/KV/D1/etc. task. See `README.md` for the user-facing feature description and the external services used.

## Commands

This repo uses **bun**, not npm.

- `bun install` — install dependencies
- `bun run dev` — local dev server (`wrangler dev --test-scheduled`)
- `bun run deploy` — deploy the Worker
- `bun run register` — publish the slash commands to Discord (loads `.dev.vars`)
- `bun run cf-typegen` — regenerate `worker-configuration.d.ts`; run after changing bindings/vars in `wrangler.jsonc`
- `bunx tsc --noEmit` — type-check (there is no test suite; this is the check to run)
- `bunx wrangler deploy --dry-run --outdir=/tmp/out` — verify the bundle builds without deploying
- `curl "http://localhost:8787/__scheduled"` — trigger the cron handler against `bun run dev`

## Architecture

A single Worker (`src/index.ts`) exposes two handlers:

- **`fetch`** — Discord HTTP interactions. Verifies the Ed25519 signature (`discord-interactions` `verifyKey`), answers `PING` with `PONG`, then dispatches to `handleInteraction` (`src/interactions.ts`). `/ping` replies immediately; `/earnings reminder <symbol>` returns a **deferred** (type 5) response and finishes the work in `ctx.waitUntil` — Finnhub lookup, Mongo write, then edits the original response via the follow-up webhook.
- **`scheduled`** — cron handler. `runScheduled` (`src/reminderScheduler.ts`) prunes past reminders and sends any due ones. It is **awaited** (not `waitUntil`) so the invocation stays alive until the work completes.

Module roles: `finnhub.ts` (earnings calendar client + `CheckedMarketHour` bmo/dmh/amc and its ordering), `reminderStore.ts` (MongoDB Atlas access), `dates.ts` (New York time math + user-facing formatting), `discord.ts` (REST v10 helpers + interaction types), `register.ts` (standalone command registration), `env.ts` (`Env` shape).

This is a port of a prior Swift/DiscordBM Gateway bot; the Mongo document schema (single `reminders` collection, snake_case field names, BSON `Date`s) is preserved from that version for data compatibility.

## Critical constraints

These are non-obvious and easy to reintroduce as bugs:

1. **MongoDB driver loading.** `mongodb` is imported **type-only** at module top; the runtime module is loaded via dynamic `import('mongodb')` *inside a handler*. `bson`'s module initializer generates random bytes, which Workers forbid in global scope. Keep the dynamic import.

2. **MongoClient is per-invocation, never cached across requests.** A Worker cannot reuse a socket created in a previous request's I/O context — a module-global cached client hangs the *next* invocation on a warm isolate. Each `ReminderStore` owns its client and must be `close()`d in a `finally` at the call site (see `runScheduled` and `handleEarnings`).

3. **The `mongodb` driver does not run under the Bun CLI** (`bson` calls `node:v8` `isBuildingSnapshot`, unimplemented in Bun) — only under `workerd` (`wrangler dev`/`deploy`). Do not write `bun` scripts that touch Atlas. Exercise DB behavior through the Worker (e.g. the `/__scheduled` endpoint), or seed/inspect data via the Atlas UI / `mongosh`.

4. **Idempotent scheduler.** Each reminder expands to dated "instances" (e.g. `1pm-yesterday`, `9am-today`); sent instance keys are recorded in `sent_keys`, so re-running the scheduler never double-sends. The handler ignores `event.cron` and uses wall-clock `now`. Crons are UTC and intentionally cover 9am/1pm/3pm in **both** EST and EDT — the dedup makes the redundant hour a harmless no-op.

5. **All scheduling and formatting is anchored to `America/New_York`** (`src/dates.ts`, via luxon for arithmetic and `Intl` for display). Don't do date math in local/UTC time.

## Configuration

- **Secrets** (`wrangler secret put`, or `.dev.vars` locally): `DISCORD_BOT_TOKEN`, `FINNHUB_API_KEY`, `MONGO_DB_URI`.
- **Vars** (`wrangler.jsonc`): `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_DEV_GUILD_ID` (optional). `DISCORD_PUBLIC_KEY` gates signature verification — an empty value in production fails every interaction.
- During `wrangler dev`, `.dev.vars` overrides `wrangler.jsonc` vars; in production only `wrangler.jsonc` + secrets apply.

**Command registration is decoupled from deploy.** `bun run register` does a `PUT` bulk-overwrite of the command set for one scope — the dev guild if `DISCORD_DEV_GUILD_ID` is set (near-instant), otherwise global (slow to propagate). Re-running deletes commands not in the payload, but only within that scope; guild and global sets are independent. Testing interactions end-to-end also requires the **Interactions Endpoint URL** (Discord Developer Portal) to point at a public URL for the Worker — `localhost` is not reachable by Discord, so use a tunnel or a deploy. The `scheduled` handler, by contrast, is testable locally via the curl above.
