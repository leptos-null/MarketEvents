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

// A single MongoClient is reused across requests/invocations. The driver runs on
// Workers with `nodejs_compat`; `maxPoolSize: 1` suits the serverless model.
let cachedClient: MongoClient | undefined;

export class ReminderStore {
	constructor(private readonly uri: string) {}

	// Lazily import the driver and create the (cached) client so `bson`'s module
	// initializer runs inside a handler rather than in global scope.
	private async collection(): Promise<Collection<ReminderElement>> {
		if (!cachedClient) {
			const { MongoClient } = await import('mongodb');
			cachedClient = new MongoClient(this.uri, {
				maxPoolSize: 1,
				minPoolSize: 0,
				serverSelectionTimeoutMS: 5000,
			});
		}
		// `db()` with no name uses the database from the connection string
		return cachedClient.db().collection<ReminderElement>('reminders');
	}

	// Upsert (vs. the Swift `insertEncoded`, which threw on a duplicate `_id`):
	// re-adding the same symbol/channel now refreshes the earnings date.
	async add(element: ReminderElement): Promise<void> {
		const collection = await this.collection();
		const { _id, ...rest } = element;
		await collection.replaceOne({ _id }, rest, { upsert: true });
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
