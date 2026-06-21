import { addMonths, formatFinnhubDate, parseFinnhubDate, startOfDayNewYork } from './dates';

// https://finnhub.io/docs/api/introduction
const BASE_URL = 'https://finnhub.io/api/v1';

// closed-set version of Finnhub's free-form `hour` field
export type CheckedMarketHour = 'bmo' | 'amc' | 'dmh';

export function isCheckedMarketHour(value: string): value is CheckedMarketHour {
	return value === 'bmo' || value === 'amc' || value === 'dmh';
}

// Ordering ported from the Swift `Comparable` conformance: bmo < dmh < amc.
export const MARKET_HOUR_ORDER: Record<CheckedMarketHour, number> = {
	bmo: 0,
	dmh: 1,
	amc: 2,
};

export interface EarningsEvent {
	date: Date;
	hour?: string;
	symbol: string;
}

interface RawEarningsEvent {
	date: string;
	hour?: string;
	symbol: string;
}

interface RawCalendarResponse {
	earningsCalendar?: RawEarningsEvent[];
}

export class FinnhubClient {
	constructor(private readonly apiKey: string) {}

	// https://finnhub.io/docs/api/earnings-calendar
	async earningsFor(symbol: string, fromDate?: Date, toDate?: Date): Promise<EarningsEvent[]> {
		const url = new URL(`${BASE_URL}/calendar/earnings`);
		url.searchParams.set('symbol', symbol);
		if (fromDate) {
			url.searchParams.set('from', formatFinnhubDate(fromDate));
		}
		if (toDate) {
			url.searchParams.set('to', formatFinnhubDate(toDate));
		}

		const response = await fetch(url, {
			headers: { 'X-Finnhub-Token': this.apiKey },
		});

		if (!(response.status >= 200 && response.status < 400)) {
			throw new Error(`Finnhub request failed with status ${response.status}`);
		}

		const body = (await response.json()) as RawCalendarResponse;
		return (body.earningsCalendar ?? []).map((event) => ({
			date: parseFinnhubDate(event.date),
			hour: event.hour || undefined,
			symbol: event.symbol,
		}));
	}

	async nextEarnings(symbol: string, after: Date = new Date()): Promise<EarningsEvent | undefined> {
		// take the floor of `after` to allow setting reminders on the day of `after`
		const startOfDay = startOfDayNewYork(after);
		// 1 quarter
		const futureDate = addMonths(startOfDay, 3);

		const events = await this.earningsFor(symbol, startOfDay, futureDate);

		return events
			// defensive: Finnhub's `from` is date-granular, so this only guards against
			// the API returning out-of-range events.
			.filter((event) => event.date.getTime() >= startOfDay.getTime())
			.sort((lhs, rhs) => lhs.date.getTime() - rhs.date.getTime())
			.at(0);
	}
}
