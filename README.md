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
    1. Environment variable in this repo: `DISCORD_BOT_TOKEN`
    2. Documentation: https://docs.discord.com/developers/quick-start/getting-started
    3. Usage: Sending messages in Discord, adding slash commands, etc.
2. Finnhub
    1. Environment variable in this repo: `FINNHUB_API_KEY`
    2. Documentation: https://finnhub.io/docs/api/introduction
    3. Usage: Getting the upcoming earnings date for a given ticker symbol
3. MongoDB Atlas
    1. Environment variable in this repo: `MONGO_DB_URI`
    2. Documentation: https://www.mongodb.com/products/platform
    3. Usage: Storing reminders persistently (across runs). I thought about using a local database, however I thought using a remote service for storage would be more convenient for when I switch the bot between hosting providers (the bot itself, not the storage provider).
