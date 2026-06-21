-- Initial schema for the Market Events reminder store (D1 / SQLite).
--
-- Normalized: `earnings` holds one row per symbol (the upcoming event), and
-- `reminders` holds one row per channel subscription to a symbol. `sent_keys`
-- records which scheduler instances ("1pm-yesterday", "9am-today", ...) have
-- already been dispatched for a given (channel, symbol).
--
-- Dates are stored as INTEGER epoch milliseconds (Date.getTime()) so range
-- comparisons are unambiguous.
--
-- Foreign keys cascade on delete: removing an `earnings` row (e.g. in `prune`)
-- removes its `reminders`, which in turn removes their `sent_keys`. D1 enforces
-- foreign keys, so deleting the parent is enough.

CREATE TABLE earnings (
	symbol         TEXT PRIMARY KEY,
	earnings_date  INTEGER NOT NULL,
	earnings_hour  TEXT NOT NULL
);

CREATE INDEX earnings_by_date ON earnings (earnings_date);

CREATE TABLE reminders (
	channel_id  TEXT NOT NULL,
	symbol      TEXT NOT NULL REFERENCES earnings(symbol) ON DELETE CASCADE,
	created_at  INTEGER NOT NULL,
	PRIMARY KEY (channel_id, symbol)
);

CREATE TABLE sent_keys (
	channel_id  TEXT NOT NULL,
	symbol      TEXT NOT NULL,
	key         TEXT NOT NULL,
	PRIMARY KEY (channel_id, symbol, key),
	FOREIGN KEY (channel_id, symbol) REFERENCES reminders(channel_id, symbol) ON DELETE CASCADE
);
