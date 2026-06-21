/**
 * Market Events — a Discord bot that reminds a channel about upcoming earnings.
 *
 * On Cloudflare Workers the bot is split across two handlers:
 *  - `fetch`: receives Discord HTTP interactions (verifies the Ed25519 signature,
 *    answers PINGs, dispatches slash commands).
 *  - `scheduled`: cron trigger that prunes old reminders and sends any that are due.
 *
 * Secrets/vars are documented in README.md and `.dev.vars.example`.
 *  - Run `bun run dev` to start a local development server
 *  - Run `bun run register` to publish the slash commands
 *  - Run `bun run deploy` to publish the Worker
 */
import { InteractionResponseType, InteractionType, verifyKey } from 'discord-interactions';
import type { Interaction } from './discord';
import type { Env } from './env';
import { handleInteraction } from './interactions';
import { runScheduled } from './reminderScheduler';

export default {
	async fetch(req, env, ctx): Promise<Response> {
		if (req.method !== 'POST') {
			return new Response('Method not allowed', { status: 405 });
		}

		const signature = req.headers.get('X-Signature-Ed25519');
		const timestamp = req.headers.get('X-Signature-Timestamp');
		const body = await req.text();

		if (!signature || !timestamp) {
			return new Response('Missing signature headers', { status: 401 });
		}

		const isValid = await verifyKey(body, signature, timestamp, env.DISCORD_PUBLIC_KEY);
		if (!isValid) {
			return new Response('Invalid request signature', { status: 401 });
		}

		let interaction: Interaction;
		try {
			interaction = JSON.parse(body) as Interaction;
		} catch {
			return new Response('Invalid request body', { status: 400 });
		}

		if (interaction.type === InteractionType.PING) {
			return Response.json({ type: InteractionResponseType.PONG });
		}

		if (interaction.type === InteractionType.APPLICATION_COMMAND) {
			return handleInteraction(interaction, env, ctx);
		}

		return new Response('Unsupported interaction type', { status: 400 });
	},

	async scheduled(_event, env): Promise<void> {
		// awaited (not `waitUntil`) so the runtime keeps the invocation alive until
		// prune + send complete, and any error propagates to the logs.
		await runScheduled(env);
	},
} satisfies ExportedHandler<Env>;
