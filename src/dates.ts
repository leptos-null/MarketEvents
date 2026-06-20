import { DateTime } from 'luxon';

// All market-event scheduling is anchored to New York time, matching the
// behavior of the exchanges. These helpers replace the Swift implementation's
// `Calendar`/`Date.FormatStyle` configured for `America/New_York` + `en_US_POSIX`.
export const NEW_YORK_ZONE = 'America/New_York';

function inNewYork(date: Date): DateTime {
	return DateTime.fromJSDate(date, { zone: NEW_YORK_ZONE });
}

export function startOfDayNewYork(date: Date): Date {
	return inNewYork(date).startOf('day').toJSDate();
}

export function addDays(date: Date, days: number): Date {
	return inNewYork(date).plus({ days }).toJSDate();
}

export function addMonths(date: Date, months: number): Date {
	return inNewYork(date).plus({ months }).toJSDate();
}

// Sets the hour-of-day (New York time) and zeroes out smaller components,
// mirroring `Calendar.date(bySettingHour:minute:second:of:)`.
export function setHourNewYork(date: Date, hour: number): Date {
	return inNewYork(date).set({ hour, minute: 0, second: 0, millisecond: 0 }).toJSDate();
}

export function newYorkYearMonthDay(date: Date): { year: number; month: number; day: number } {
	const dateTime = inNewYork(date);
	return { year: dateTime.year, month: dateTime.month, day: dateTime.day };
}

// Finnhub represents dates as `YYYY-MM-DD`; interpret them at the New York
// start-of-day, matching the Swift decoder's ISO8601 year/month/day strategy.
export function parseFinnhubDate(value: string): Date {
	return DateTime.fromFormat(value, 'yyyy-MM-dd', { zone: NEW_YORK_ZONE }).toJSDate();
}

export function formatFinnhubDate(date: Date): string {
	return inNewYork(date).toFormat('yyyy-MM-dd');
}

// e.g. "February 12, 2026" — matches `Date.FormatStyle(date: .long)` in en_US_POSIX.
const longDateFormatter = new Intl.DateTimeFormat('en-US', {
	timeZone: NEW_YORK_ZONE,
	dateStyle: 'long',
});

export function formatLongDateNewYork(date: Date): string {
	return longDateFormatter.format(date);
}

// matches `ListFormatStyle.list(type: .and, width: .narrow)` in en_US_POSIX.
const symbolListFormatter = new Intl.ListFormat('en-US', { style: 'narrow', type: 'conjunction' });

export function formatSymbolList(symbols: string[]): string {
	return symbolListFormatter.format(symbols);
}
