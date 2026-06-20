export interface Env {
	// secrets (set via `wrangler secret put` / `.dev.vars`)
	DISCORD_BOT_TOKEN: string;
	FINNHUB_API_KEY: string;
	MONGO_DB_URI: string;

	// vars (set in wrangler.jsonc)
	DISCORD_PUBLIC_KEY: string;
	DISCORD_APPLICATION_ID: string;
	// optional: when set, slash commands register to this guild only (fast iteration)
	DISCORD_DEV_GUILD_ID?: string;
}
