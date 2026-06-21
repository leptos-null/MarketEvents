import { addDays, formatLongDateNewYork, formatSymbolList, newYorkYearMonthDay, setHourNewYork, startOfDayNewYork } from './dates';
import { createMessage } from './discord';
import { type CheckedMarketHour, MARKET_HOUR_ORDER } from './finnhub';
import type { Env } from './env';
import { type ReminderElement, ReminderStore } from './reminderStore';

// Schedule for each reporting hour (New York time):
//
//   before market open (bmo):
//     - 1pm the day before
//   after market close (amc):
//     - 9am the day of
//     - 3pm the day of
//   during market hours (dmh):
//     - 1pm the day before
//     - 9am the day of
//
// Replaces the Swift `ReminderScheduler` timer loop. Invoked by the cron trigger;
// `sent_keys` dedup makes it idempotent, so no in-flight lock is needed.

interface ReminderInstance {
	key: string;
	date: Date;
}

interface StapledReminder {
	reminder: ReminderElement;
	instances: ReminderInstance[];
}

export async function runScheduled(env: Env): Promise<void> {
	const reminderStore = new ReminderStore(env.DB);
	await reminderStore.prune();
	await sendIfNeeded(reminderStore, env, new Date());
}

function reminderInstances(reminder: ReminderElement): ReminderInstance[] {
	// `earnings_date` is already probably start-of-day, but just to be sure
	const startOfEarningsDate = startOfDayNewYork(reminder.earnings_date);
	const build: ReminderInstance[] = [];

	switch (reminder.earnings_hour) {
		case 'bmo':
			// 1pm the day before
			build.push({ key: '1pm-yesterday', date: setHourNewYork(addDays(startOfEarningsDate, -1), 13) });
			break;
		case 'amc':
			// 9am the day of
			build.push({ key: '9am-today', date: setHourNewYork(startOfEarningsDate, 9) });
			// 3pm the day of
			build.push({ key: '3pm-today', date: setHourNewYork(startOfEarningsDate, 15) });
			break;
		case 'dmh':
			// 1pm the day before
			build.push({ key: '1pm-yesterday', date: setHourNewYork(addDays(startOfEarningsDate, -1), 13) });
			// 9am the day of
			build.push({ key: '9am-today', date: setHourNewYork(startOfEarningsDate, 9) });
			break;
	}

	return build;
}

async function sendIfNeeded(reminderStore: ReminderStore, env: Env, now: Date): Promise<void> {
	const startOfDay = startOfDayNewYork(now);
	// for simplicity, get the next 3 days
	const intervalEnd = addDays(startOfDay, 3);

	// to avoid requiring very precise timing, send reminders up to 100 seconds early
	const maxDate = now.getTime() + 100 * 1000;

	const collected: StapledReminder[] = [];
	for (const reminder of await reminderStore.findInRange(startOfDay, intervalEnd)) {
		const sentKeys = new Set(reminder.sent_keys ?? []);
		const instances = reminderInstances(reminder).filter(
			(instance) => !sentKeys.has(instance.key) && instance.date.getTime() <= maxDate,
		);
		if (instances.length > 0) {
			collected.push({ reminder, instances });
		}
	}

	await sendMessages(reminderStore, env, collected);
}

async function sendMessages(reminderStore: ReminderStore, env: Env, staples: StapledReminder[]): Promise<void> {
	// channel -> (year/month/day/hour bin) -> stapled reminders
	const channelBins = new Map<string, Map<string, StapledReminder[]>>();
	for (const staple of staples) {
		const { year, month, day } = newYorkYearMonthDay(staple.reminder.earnings_date);
		const binKey = `${year}-${month}-${day}-${staple.reminder.earnings_hour}`;

		const bins = channelBins.get(staple.reminder.channel_id) ?? new Map<string, StapledReminder[]>();
		const bin = bins.get(binKey) ?? [];
		bin.push(staple);
		bins.set(binKey, bin);
		channelBins.set(staple.reminder.channel_id, bins);
	}

	const results = await Promise.allSettled(
		[...channelBins].map(([channelId, bins]) => sendMessage(reminderStore, env, channelId, bins)),
	);
	for (const result of results) {
		if (result.status === 'rejected') {
			console.error('sendMessage', result.reason);
		}
	}
}

interface ReminderSection {
	staples: StapledReminder[];
	date: Date;
	hour: CheckedMarketHour;
}

async function sendMessage(
	reminderStore: ReminderStore,
	env: Env,
	channelId: string,
	bins: Map<string, StapledReminder[]>,
): Promise<void> {
	const sections: ReminderSection[] = [];
	for (const staples of bins.values()) {
		const first = staples.at(0);
		if (!first) {
			continue;
		}
		sections.push({ staples, date: first.reminder.earnings_date, hour: first.reminder.earnings_hour });
	}

	sections.sort((lhs, rhs) => {
		const dateDiff = lhs.date.getTime() - rhs.date.getTime();
		if (dateDiff !== 0) {
			return dateDiff;
		}
		return MARKET_HOUR_ORDER[lhs.hour] - MARKET_HOUR_ORDER[rhs.hour];
	});

	const sectionContents = sections.map((section) => {
		let sectionMessage = `### ${formatLongDateNewYork(section.date)}`;
		switch (section.hour) {
			case 'bmo':
				sectionMessage += ' before market open';
				break;
			case 'amc':
				sectionMessage += ' after market close';
				break;
			case 'dmh':
				sectionMessage += ' during market hours';
				break;
		}
		sectionMessage += '\n';
		sectionMessage += formatSymbolList(section.staples.map((staple) => staple.reminder.symbol));
		return sectionMessage;
	});

	await createMessage(env.DISCORD_BOT_TOKEN, channelId, {
		embeds: [{ title: 'Earnings Reminders', description: sectionContents.join('\n') }],
	});

	// record which instance keys we just sent, per reminder
	const sentKeysByReminder = new Map<string, { channelId: string; symbol: string; keys: Set<string> }>();
	for (const section of sections) {
		for (const staple of section.staples) {
			// snowflakes shouldn't contain `_`, so this composite id shouldn't collide
			const mapKey = `${staple.reminder.symbol}_${staple.reminder.channel_id}`;
			const entry = sentKeysByReminder.get(mapKey) ?? {
				channelId: staple.reminder.channel_id,
				symbol: staple.reminder.symbol,
				keys: new Set<string>(),
			};
			for (const instance of staple.instances) {
				entry.keys.add(instance.key);
			}
			sentKeysByReminder.set(mapKey, entry);
		}
	}

	await Promise.all(
		[...sentKeysByReminder.values()].map((entry) => reminderStore.markSent(entry.channelId, entry.symbol, [...entry.keys])),
	);
}
