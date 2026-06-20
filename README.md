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

Running this project requires tokens/ secrets for accessing 3 services:

1. Discord
    1. Environment variables in this repo: `DISCORD_BOT_TOKEN` (secret), `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY`
    2. Documentation: https://docs.discord.com/developers/quick-start/getting-started
    3. Usage: Sending messages in Discord, adding slash commands, and receiving [HTTP interactions](https://docs.discord.com/developers/interactions/overview). `DISCORD_PUBLIC_KEY` verifies request signatures; `DISCORD_APPLICATION_ID` is used for command registration and interaction follow-ups.
2. Finnhub
    1. Environment variable in this repo: `FINNHUB_API_KEY`
    2. Documentation: https://finnhub.io/docs/api/introduction
    3. Usage: Getting the upcoming earnings date for a given ticker symbol
3. MongoDB Atlas
    1. Environment variable in this repo: `MONGO_DB_URI`
    2. Documentation: https://www.mongodb.com/products/platform
    3. Usage: Storing reminders persistently (across runs). I thought about using a local database, however I thought using a remote service for storage would be more convenient for when I switch the bot between hosting providers (the bot itself, not the storage provider).

### Running

This project runs on [Cloudflare Workers](https://developers.cloudflare.com/workers/). The bot is split across two handlers: a `fetch` handler that receives Discord HTTP interactions, and a `scheduled` (cron) handler that sends due earnings reminders.

1. Copy `.dev.vars.example` to `.dev.vars` and fill in the values.
2. Local development: `bun run dev` (the `--test-scheduled` flag lets you trigger the cron handler via `curl "http://localhost:8787/__scheduled"`).
3. Register the slash commands with Discord: `bun run register` (set `DISCORD_DEV_GUILD_ID` in `.dev.vars` to scope them to a single guild during development).
4. Deploy: set secrets with `wrangler secret put DISCORD_BOT_TOKEN` (and `FINNHUB_API_KEY`, `MONGO_DB_URI`), fill in the `vars` in `wrangler.jsonc`, then `bun run deploy`.
5. In the [Discord Developer Portal](https://discord.com/developers/applications), set the app's **Interactions Endpoint URL** to the deployed Worker URL. Discord validates it by sending a `PING`.
