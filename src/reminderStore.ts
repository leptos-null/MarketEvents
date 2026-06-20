// `mongodb` is imported for types only here; the runtime module is loaded lazily
// (see `collection()`) because `bson` generates random bytes in its module
// initializer, which Workers disallow in global scope.
import type { Collection, FindCursor, MongoClient } from 'mongodb';
import { addDays, startOfDayNewYork } from './dates';
import type { CheckedMarketHour } from './finnhub';

// if we were using a relational database, I would probably split this up into 2 tables:
// - earnings (symbol, date, hour)
// - reminders (channel_id, symbol, created_at)
// since MongoDB Atlas is not relational, maintaining 2 tables is more error-prone,
// so we use a single collection here.
//
// Field names match the Swift `ReminderStore.Element.CodingKeys` so existing
// documents remain compatible.
export interface ReminderElement {
	_id: string;

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

// snowflakes shouldn't contain `_`, so this composite id shouldn't collide
export function reminderId(symbol: string, channelId: string): string {
	return `${symbol}_${channelId}`;
}

export class ReminderStore {
	// One client per instance (i.e. per invocation), opened lazily and closed via
	// `close()`. A Worker cannot reuse a socket created in a previous request's I/O
	// context, so caching the client across invocations hangs the next one.
	private client: MongoClient | undefined;

	constructor(private readonly uri: string) {}

	// Lazily import the driver so `bson`'s module initializer runs inside a handler
	// rather than in global scope (Workers disallow RNG there).
	private async collection(): Promise<Collection<ReminderElement>> {
		if (!this.client) {
			const { MongoClient } = await import('mongodb');
			this.client = new MongoClient(this.uri, {
				maxPoolSize: 1,
				minPoolSize: 0,
				serverSelectionTimeoutMS: 5000,
			});
		}
		// `db()` with no name uses the database from the connection string
		return this.client.db().collection<ReminderElement>('reminders');
	}

	// Call once the invocation is done with the store. Safe if never opened.
	async close(): Promise<void> {
		await this.client?.close();
		this.client = undefined;
	}

	// Upsert (vs. the Swift `insertEncoded`, which threw on a duplicate `_id`):
	// re-adding the same symbol/channel refreshes the earnings event. `sent_keys`
	// is preserved when the earnings date is unchanged — so an instance that has
	// already been dispatched isn't re-sent on a re-run — and reset only when the
	// date moves to a new event. `created_at` is written once, on insert.
	async add(element: ReminderElement): Promise<void> {
		const collection = await this.collection();
		const { _id, created_at, sent_keys: _ignored, ...rest } = element;
		// Wrap assigned fields in `$literal` so a value beginning with `$` is stored
		// verbatim rather than interpreted as an aggregation field path.
		const fields = Object.fromEntries(Object.entries(rest).map(([key, value]) => [key, { $literal: value }]));
		// `$earnings_date` / `$sent_keys` reference the existing document (pre-update);
		// on insert they're missing, so `sent_keys` falls through to `[]`.
		await collection.updateOne(
			{ _id },
			[
				{
					$set: {
						...fields,
						created_at: { $ifNull: ['$created_at', created_at] },
						sent_keys: {
							$cond: [{ $eq: ['$earnings_date', rest.earnings_date] }, { $ifNull: ['$sent_keys', []] }, []],
						},
					},
				},
			],
			{ upsert: true },
		);
	}

	async prune(now: Date = new Date()): Promise<void> {
		const collection = await this.collection();
		const today = startOfDayNewYork(now);
		// just to be safe, go back 1 day
		const dayBefore = addDays(today, -1);
		await collection.deleteMany({ earnings_date: { $lte: dayBefore } });
	}

	async findInRange(start: Date, end: Date): Promise<FindCursor<ReminderElement>> {
		const collection = await this.collection();
		return collection.find({ earnings_date: { $gte: start, $lt: end } });
	}

	// `$addToSet` is race-safe vs. the Swift full-document replace.
	async markSent(id: string, keys: string[]): Promise<void> {
		if (keys.length === 0) {
			return;
		}
		const collection = await this.collection();
		await collection.updateOne({ _id: id }, { $addToSet: { sent_keys: { $each: keys } } });
	}
}
