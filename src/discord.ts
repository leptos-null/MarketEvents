// Minimal Discord REST v10 helpers + the subset of interaction types we use.
const DISCORD_API = 'https://discord.com/api/v10';

export interface DiscordEmbed {
	title?: string;
	description?: string;
	color?: number;
}

// Discord brand colors (the Swift code used DiscordBM's `.yellow` / `.red`).
export const EMBED_COLOR = {
	yellow: 0xfee75c,
	red: 0xed4245,
} as const;

export interface InteractionOption {
	name: string;
	type: number;
	value?: string | number | boolean;
	options?: InteractionOption[];
}

export interface InteractionData {
	id: string;
	name: string;
	options?: InteractionOption[];
}

export interface Interaction {
	id: string;
	application_id: string;
	type: number;
	token: string;
	channel_id?: string;
	data?: InteractionData;
}

export interface MessagePayload {
	content?: string;
	embeds?: DiscordEmbed[];
}

// POST a message to a channel (used by the scheduler). Requires a bot token.
export async function createMessage(token: string, channelId: string, payload: MessagePayload): Promise<void> {
	const response = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
		method: 'POST',
		headers: {
			Authorization: `Bot ${token}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(payload),
	});
	if (!response.ok) {
		throw new Error(`createMessage failed: ${response.status} ${await response.text()}`);
	}
}

// Edit the original (deferred) interaction response. Authenticated by the
// interaction token, so no bot token is required.
export async function editOriginalInteractionResponse(
	applicationId: string,
	interactionToken: string,
	payload: MessagePayload,
): Promise<void> {
	const response = await fetch(`${DISCORD_API}/webhooks/${applicationId}/${interactionToken}/messages/@original`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(payload),
	});
	if (!response.ok) {
		throw new Error(`editOriginalInteractionResponse failed: ${response.status} ${await response.text()}`);
	}
}

// Bulk-overwrite application commands (used by the register script).
export async function registerCommands(
	token: string,
	applicationId: string,
	guildId: string | undefined,
	commands: unknown[],
): Promise<unknown[]> {
	const url = guildId
		? `${DISCORD_API}/applications/${applicationId}/guilds/${guildId}/commands`
		: `${DISCORD_API}/applications/${applicationId}/commands`;

	const response = await fetch(url, {
		method: 'PUT',
		headers: {
			Authorization: `Bot ${token}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(commands),
	});
	if (!response.ok) {
		throw new Error(`registerCommands failed: ${response.status} ${await response.text()}`);
	}
	return (await response.json()) as unknown[];
}
