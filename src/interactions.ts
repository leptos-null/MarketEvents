import { InteractionResponseType } from 'discord-interactions';
import { formatLongDateNewYork } from './dates';
import {
	EMBED_COLOR,
	editOriginalInteractionResponse,
	type Interaction,
	type InteractionData,
	type MessagePayload,
} from './discord';
import { FinnhubClient, isCheckedMarketHour } from './finnhub';
import type { Env } from './env';
import { type ReminderElement, ReminderStore, reminderId } from './reminderStore';

function interactionResponse(body: unknown): Response {
	return Response.json(body);
}

// Port of `DiscordEventHandler.onInteractionCreate`. Returns the immediate HTTP
// response; longer work (the `earnings` command) continues via `ctx.waitUntil`.
export function handleInteraction(interaction: Interaction, env: Env, ctx: ExecutionContext): Response {
	const data = interaction.data;
	if (!data) {
		return interactionResponse({
			type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			data: { content: 'Missing interaction data', flags: 64 },
		});
	}

	switch (data.name) {
		case 'ping':
			return interactionResponse({
				type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
				data: { content: 'pong' },
			});
		case 'earnings':
			// acknowledge now; the Finnhub call + DB write happen in the background
			// and edit the original response when complete.
			ctx.waitUntil(handleEarnings(interaction, data, env));
			return interactionResponse({
				type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
			});
		default:
			return interactionResponse({
				type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
				data: { content: 'Unknown command', flags: 64 },
			});
	}
}

async function handleEarnings(interaction: Interaction, data: InteractionData, env: Env): Promise<void> {
	const update = (payload: MessagePayload): Promise<void> =>
		editOriginalInteractionResponse(env.DISCORD_APPLICATION_ID, interaction.token, payload);

	try {
		// currently `reminder` is the only subcommand, but there may be others later
		const subcommand = data.options?.at(0);
		if (!subcommand || subcommand.name !== 'reminder') {
			await update({ content: 'Unknown command' });
			return;
		}

		const symbolOption = subcommand.options?.find((option) => option.name === 'symbol');
		const symbol = typeof symbolOption?.value === 'string' ? symbolOption.value : undefined;
		if (!symbol) {
			await update({ content: 'Missing symbol' });
			return;
		}

		const upperSymbol = symbol.toUpperCase();

		const finnhubClient = new FinnhubClient(env.FINNHUB_API_KEY);
		const earnings = await finnhubClient.nextEarnings(upperSymbol);
		if (!earnings) {
			await update({ content: `No upcoming earnings found for ${upperSymbol}` });
			return;
		}

		let message = `${earnings.symbol} reports earnings on ${formatLongDateNewYork(earnings.date)}`;

		const checkedHour = earnings.hour && isCheckedMarketHour(earnings.hour) ? earnings.hour : undefined;
		if (!checkedHour) {
			await update({
				content: message,
				embeds: [{ description: 'Report hour not found. Please check again closer to the date.', color: EMBED_COLOR.yellow }],
			});
			return;
		}

		switch (checkedHour) {
			case 'bmo':
				message += ' before market open';
				break;
			case 'amc':
				message += ' after market close';
				break;
			case 'dmh':
				message += ' during market hours';
				break;
		}

		const channelId = interaction.channel_id;
		if (!channelId) {
			await update({
				content: message,
				embeds: [{ description: 'Requested channel not found - unable to create reminder.', color: EMBED_COLOR.red }],
			});
			return;
		}

		const reminder: ReminderElement = {
			_id: reminderId(upperSymbol, channelId),
			channel_id: channelId,
			symbol: upperSymbol,
			earnings_date: earnings.date,
			earnings_hour: checkedHour,
			created_at: new Date(),
			sent_keys: [],
		};

		const reminderStore = new ReminderStore(env.MONGO_DB_URI);
		try {
			await reminderStore.add(reminder);
		} finally {
			await reminderStore.close();
		}

		message += '.\n';
		message += "I'll remind you before the report";

		await update({ content: message });
	} catch (error) {
		console.error('handleEarnings', error);
		await update({ content: 'Something went wrong handling your request.' }).catch(() => {});
	}
}
