/**
 * Registers the bot's slash commands with Discord. Run via `bun run register`
 * (which loads `.dev.vars`). Replaces the Swift bot's startup
 * `bulkSetApplicationCommands` call.
 *
 * Set `DISCORD_DEV_GUILD_ID` to register to a single guild (changes apply almost
 * immediately); leave it unset to register globally (can take up to an hour).
 */
import { registerCommands } from '../src/discord';

// Discord application command type
const CHAT_INPUT = 1;
// Discord application command option types
const SUB_COMMAND = 1;
const STRING = 3;

const commands = [
	{
		name: 'ping',
		description: 'Check that bot is responsive',
		type: CHAT_INPUT,
	},
	{
		name: 'earnings',
		description: 'Company earnings events',
		type: CHAT_INPUT,
		options: [
			{
				type: SUB_COMMAND,
				name: 'reminder',
				description: 'Set a reminder for earnings',
				options: [
					{
						type: STRING,
						name: 'symbol',
						description: 'Stock ticker symbol',
						required: true,
					},
				],
			},
		],
	},
];

const token = process.env.DISCORD_BOT_TOKEN;
const applicationId = process.env.DISCORD_APPLICATION_ID;
const guildId = process.env.DISCORD_DEV_GUILD_ID;

if (!token || !applicationId) {
	console.error('DISCORD_BOT_TOKEN and DISCORD_APPLICATION_ID are required');
	process.exit(1);
}

const registered = await registerCommands(token, applicationId, guildId, commands);
console.log(`Registered ${registered.length} commands ${guildId ? `for guild ${guildId}` : 'globally'}`);
