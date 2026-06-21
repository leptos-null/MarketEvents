## Market Events

Market Events is a Discord bot to remind a channel about upcoming market events.

Currently, the only supported event type is earnings reports: Add a reminder with `/earnings reminder <symbol>`

Example:

> [user] 
> `/earnings reminder RIVN`

> [bot] 
> RIVN reports earnings on February 12, 2026 after market close.
> I'll remind you before the report

Later, the bot sends a reminder:

> ## Earnings Reminders
>
> ### February 12, 2026 after market close
>
> RIVN

The reminder is formatted this way so that multiple symbols may be listed in the reminder.

### Services

Running this project requires tokens/ secrets for accessing 2 external services, plus a Cloudflare D1 database:

1. Discord
    1. Environment variables in this repo: `DISCORD_BOT_TOKEN` (secret), `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY`
    2. Documentation: https://docs.discord.com/developers/quick-start/getting-started
    3. Usage: Sending messages in Discord, adding slash commands, and receiving [HTTP interactions](https://docs.discord.com/developers/interactions/overview). `DISCORD_PUBLIC_KEY` verifies request signatures; `DISCORD_APPLICATION_ID` is used for command registration and interaction follow-ups.
2. Finnhub
    1. Environment variable in this repo: `FINNHUB_API_KEY`
    2. Documentation: https://finnhub.io/docs/api/introduction
    3. Usage: Getting the upcoming earnings date for a given ticker symbol
3. Cloudflare D1
    1. Configured as the `DB` binding in `wrangler.jsonc` (no secret).
    2. Documentation: https://developers.cloudflare.com/d1/
    3. Usage: Storing reminders persistently (across runs). D1 is part of the Cloudflare Workers platform the bot already runs on, so reminders live alongside the Worker.

### Running

This project runs on [Cloudflare Workers](https://developers.cloudflare.com/workers/). The bot is split across two handlers: a `fetch` handler that receives Discord HTTP interactions, and a `scheduled` (cron) handler that sends due earnings reminders.

1. Copy `.dev.vars.example` to `.dev.vars` and fill in the values.
2. Create the D1 database: `bunx wrangler d1 create marketevents`, then paste the returned `database_id` into the `d1_databases` binding in `wrangler.jsonc`. Apply the schema with `bunx wrangler d1 migrations apply marketevents --local` (and `--remote` for production).
3. Local development: `bun run dev` (the `--test-scheduled` flag lets you trigger the cron handler via `curl "http://localhost:8787/__scheduled"`).
4. Register the slash commands with Discord: `bun run register` (set `DISCORD_DEV_GUILD_ID` in `.dev.vars` to scope them to a single guild during development).
5. Deploy: set secrets with `wrangler secret put DISCORD_BOT_TOKEN` (and `FINNHUB_API_KEY`), fill in the `vars` in `wrangler.jsonc`, then `bun run deploy`.
6. In the [Discord Developer Portal](https://discord.com/developers/applications), set the app's **Interactions Endpoint URL** to the deployed Worker URL. Discord validates it by sending a `PING`.
