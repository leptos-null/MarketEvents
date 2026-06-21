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
- `bunx wrangler deploy --dry-run` — verify the bundle builds without deploying
- `bunx wrangler d1 migrations apply marketevents --local` (or `--remote`) — apply schema migrations from `migrations/`
- `curl "http://localhost:8787/__scheduled"` — trigger the cron handler against `bun run dev`

## Architecture

A single Worker (`src/index.ts`) exposes two handlers:

- **`fetch`** — Discord HTTP interactions. Verifies the Ed25519 signature (`discord-interactions` `verifyKey`), answers `PING` with `PONG`, then dispatches to `handleInteraction` (`src/interactions.ts`). `/ping` replies immediately; `/earnings reminder <symbol>` returns a **deferred** (type 5) response and finishes the work in `ctx.waitUntil` — Finnhub lookup, D1 write, then edits the original response via the follow-up webhook.
- **`scheduled`** — cron handler. `runScheduled` (`src/reminderScheduler.ts`) prunes past reminders and sends any due ones. It is **awaited** (not `waitUntil`) so the invocation stays alive until the work completes.

Module roles: `finnhub.ts` (earnings calendar client + `CheckedMarketHour` bmo/dmh/amc and its ordering), `reminderStore.ts` (Cloudflare D1 access), `dates.ts` (New York time math + user-facing formatting), `discord.ts` (REST v10 helpers + interaction types), `env.ts` (`Env` shape). `scripts/register.ts` is a standalone build-time CLI (run via `bun run register`), not part of the Worker bundle.

This is a port of a prior Swift/DiscordBM Gateway bot. Storage was originally MongoDB Atlas; it is now Cloudflare D1.

### Storage schema (D1)

Normalized across three tables (`migrations/0001_init.sql`); `ReminderElement` is the denormalized shape callers use, and `ReminderStore` maps it onto the tables:

- `earnings` (`symbol` PK, `earnings_date`, `earnings_hour`) — one row per symbol; the upcoming event is **shared across channels**.
- `reminders` (`channel_id`, `symbol`, `created_at`, PK `(channel_id, symbol)`) — one subscription per row.
- `sent_keys` (`channel_id`, `symbol`, `key`, PK `(channel_id, symbol, key)`) — dispatched scheduler instances.

Dates are stored as **INTEGER epoch milliseconds** (`Date.getTime()`). Foreign keys cascade on delete (`earnings` → `reminders` → `sent_keys`), so `prune` only deletes the parent `earnings` rows. The date-change `sent_keys` reset in `add` is still explicit (the event is updated in place, not deleted) and runs in a `db.batch([...])` with the upserts.

## Critical constraints

These are non-obvious and easy to reintroduce as bugs:

1. **`add` is an upsert with conditional `sent_keys` reset.** Re-adding a symbol/channel refreshes the shared earnings event. `sent_keys` is preserved while `earnings_date` is unchanged (so an already-dispatched instance isn't re-sent) and reset **across all channels** when the date moves — because `earnings` is shared per symbol. The reset `DELETE` runs *before* the earnings upsert so it can read the old date.

2. **`created_at` is write-once.** The `reminders` upsert uses `ON CONFLICT(channel_id, symbol) DO NOTHING`, preserving the original `created_at`.

3. **Idempotent scheduler.** Each reminder expands to dated "instances" (e.g. `1pm-yesterday`, `9am-today`); sent instance keys are recorded in `sent_keys` via `INSERT OR IGNORE`, so re-running the scheduler never double-sends. The handler ignores `event.cron` and uses wall-clock `now`. Crons are UTC and intentionally cover 9am/1pm/3pm in **both** EST and EDT — the dedup makes the redundant hour a harmless no-op.

4. **All scheduling and formatting is anchored to `America/New_York`** (`src/dates.ts`, via luxon for arithmetic and `Intl` for display). Don't do date math in local/UTC time.

## Configuration

- **Secrets** (`wrangler secret put`, or `.dev.vars` locally): `DISCORD_BOT_TOKEN`, `FINNHUB_API_KEY`.
- **Vars** (`wrangler.jsonc`): `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_DEV_GUILD_ID` (optional). `DISCORD_PUBLIC_KEY` gates signature verification — an empty value in production fails every interaction.
- **Bindings** (`wrangler.jsonc`): `DB` (D1). `database_id` must be filled in from `wrangler d1 create marketevents` before deploy.
- During `wrangler dev`, `.dev.vars` overrides `wrangler.jsonc` vars; in production only `wrangler.jsonc` + secrets apply.

**Command registration is decoupled from deploy.** `bun run register` does a `PUT` bulk-overwrite of the command set for one scope — the dev guild if `DISCORD_DEV_GUILD_ID` is set (near-instant), otherwise global (slow to propagate). Re-running deletes commands not in the payload, but only within that scope; guild and global sets are independent. Testing interactions end-to-end also requires the **Interactions Endpoint URL** (Discord Developer Portal) to point at a public URL for the Worker — `localhost` is not reachable by Discord, so use a tunnel or a deploy. The `scheduled` handler, by contrast, is testable locally via the curl above.
