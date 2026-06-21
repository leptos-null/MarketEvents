import { addDays, startOfDayNewYork } from './dates';
import type { CheckedMarketHour } from './finnhub';

// Backed by Cloudflare D1 (SQLite). The data is normalized across three tables
// (see migrations/0001_init.sql):
// - `earnings`   (symbol, earnings_date, earnings_hour) — one row per symbol
// - `reminders`  (channel_id, symbol, created_at)       — one subscription per row
// - `sent_keys`  (channel_id, symbol, key)              — dispatched instances
//
// `ReminderElement` is the denormalized shape used by callers; the store maps it
// onto the tables. Dates are persisted as epoch milliseconds.
export interface ReminderElement {
	channel_id: string;
	symbol: string;

	earnings_date: Date;
	earnings_hour: CheckedMarketHour;

	created_at: Date;

	// a reminder may be sent multiple times (e.g. 1 hour before, 1 day before).
	// each of these "instances" has a key, defined by the scheduler. a key must be
	// unique within a single element; the value carries no other meaning.
	sent_keys: string[];
}

// Shape of a joined row as returned by `findInRange`.
interface ReminderRow {
	channel_id: string;
	symbol: string;
	earnings_date: number;
	earnings_hour: CheckedMarketHour;
	created_at: number;
	sent_keys: string; // JSON array of strings (json_group_array)
}

export class ReminderStore {
	constructor(private readonly db: D1Database) {}

	// Upsert: re-adding the same symbol/channel refreshes the earnings event.
	// `sent_keys` is preserved while the earnings date is unchanged — so an
	// instance already dispatched isn't re-sent — and reset when the date moves to
	// a new event (across every channel, since the event is shared per symbol).
	// `created_at` is written once, on insert.
	async add(element: ReminderElement): Promise<void> {
		const { channel_id, symbol, earnings_date, earnings_hour, created_at } = element;
		const earningsMs = earnings_date.getTime();
		await this.db.batch([
			// Reset sent instances if (and only if) the stored date differs from the
			// incoming one. Must run before the earnings upsert below reads the old date.
			this.db
				.prepare(
					'DELETE FROM sent_keys WHERE symbol = ?1 AND EXISTS (SELECT 1 FROM earnings WHERE symbol = ?1 AND earnings_date <> ?2)',
				)
				.bind(symbol, earningsMs),
			this.db
				.prepare(
					'INSERT INTO earnings (symbol, earnings_date, earnings_hour) VALUES (?1, ?2, ?3) ' +
						'ON CONFLICT(symbol) DO UPDATE SET earnings_date = excluded.earnings_date, earnings_hour = excluded.earnings_hour',
				)
				.bind(symbol, earningsMs, earnings_hour),
			this.db
				.prepare(
					'INSERT INTO reminders (channel_id, symbol, created_at) VALUES (?1, ?2, ?3) ' +
						'ON CONFLICT(channel_id, symbol) DO NOTHING',
				)
				.bind(channel_id, symbol, created_at.getTime()),
		]);
	}

	async prune(now: Date = new Date()): Promise<void> {
		const today = startOfDayNewYork(now);
		// just to be safe, go back 1 day
		const dayBefore = addDays(today, -1).getTime();
		// Deleting the parent earnings rows cascades to reminders and sent_keys.
		await this.db.prepare('DELETE FROM earnings WHERE earnings_date <= ?1').bind(dayBefore).run();
	}

	async findInRange(start: Date, end: Date): Promise<ReminderElement[]> {
		const { results } = await this.db
			.prepare(
				'SELECT r.channel_id, e.symbol, e.earnings_date, e.earnings_hour, r.created_at, ' +
					'(SELECT json_group_array(sk.key) FROM sent_keys sk WHERE sk.channel_id = r.channel_id AND sk.symbol = r.symbol) AS sent_keys ' +
					'FROM reminders r JOIN earnings e ON e.symbol = r.symbol ' +
					'WHERE e.earnings_date >= ?1 AND e.earnings_date < ?2',
			)
			.bind(start.getTime(), end.getTime())
			.all<ReminderRow>();

		return results.map((row) => ({
			channel_id: row.channel_id,
			symbol: row.symbol,
			earnings_date: new Date(row.earnings_date),
			earnings_hour: row.earnings_hour,
			created_at: new Date(row.created_at),
			sent_keys: JSON.parse(row.sent_keys) as string[],
		}));
	}

	// `INSERT OR IGNORE` is idempotent: re-recording an already-sent instance is a
	// no-op, so re-running the scheduler never double-counts.
	async markSent(channelId: string, symbol: string, keys: string[]): Promise<void> {
		if (keys.length === 0) {
			return;
		}
		const statement = this.db.prepare(
			'INSERT OR IGNORE INTO sent_keys (channel_id, symbol, key) VALUES (?1, ?2, ?3)',
		);
		await this.db.batch(keys.map((key) => statement.bind(channelId, symbol, key)));
	}
}
