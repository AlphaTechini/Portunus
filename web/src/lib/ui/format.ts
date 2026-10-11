/**
 * Formatting rules for Portunus. Every number, date and identifier shown in the UI
 * goes through one of these helpers so both sides of a deposit see the same thing.
 */

export type AmountInput = number | bigint | string;
export type DateInput = Date | number | string;

/** TIP-20 USD stablecoins on Tempo use 6 decimals. */
export const STABLECOIN_DECIMALS = 6;

/**
 * Convert an amount to a JS number of whole USD.
 * - number / numeric string: already in USD (e.g. 1250.5)
 * - bigint: base units with `decimals` (default 6), e.g. 1_250_500_000n
 */
export function toUsd(amount: AmountInput, decimals = STABLECOIN_DECIMALS): number {
	if (typeof amount === 'bigint') {
		const base = 10n ** BigInt(decimals);
		const whole = amount / base;
		const frac = amount % base;
		return Number(whole) + Number(frac) / Number(base);
	}
	if (typeof amount === 'string') return Number(amount);
	return amount;
}

export interface MoneyFormatOptions {
	/** For bigint base units. Default 6. */
	decimals?: number;
	/** ISO code used for the symbol. Default USD. */
	currency?: string;
	/** Show + for positive values (deltas, credits). */
	signed?: boolean;
	/** $1.2M style; only for KPI tiles, never for amounts someone pays or receives. */
	compact?: boolean;
	/** Drop the symbol (when a column header already says USD). */
	symbol?: boolean;
}

/** "$1,250.00". Always two decimals unless compact. */
export function formatMoney(amount: AmountInput, opts: MoneyFormatOptions = {}): string {
	const { decimals, currency = 'USD', signed = false, compact = false, symbol = true } = opts;
	const value = toUsd(amount, decimals);
	const fmt = new Intl.NumberFormat('en-US', {
		style: symbol ? 'currency' : 'decimal',
		currency: symbol ? currency : undefined,
		currencyDisplay: 'narrowSymbol',
		minimumFractionDigits: compact ? 0 : 2,
		maximumFractionDigits: compact ? 1 : 2,
		notation: compact ? 'compact' : 'standard',
		signDisplay: signed ? 'exceptZero' : 'auto'
	});
	return fmt.format(value).replace('-', '−');
}

/** Split money into parts so the cents can be styled lighter. */
export function moneyParts(
	amount: AmountInput,
	opts: MoneyFormatOptions = {}
): { sign: string; symbol: string; whole: string; fraction: string } {
	const value = toUsd(amount, opts.decimals);
	const abs = Math.abs(value);
	const whole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(
		Math.trunc(abs + 1e-9)
	);
	const fraction = abs.toFixed(2).split('.')[1] ?? '00';
	const sign = value < 0 ? '−' : opts.signed && value > 0 ? '+' : '';
	const symbol =
		opts.symbol === false
			? ''
			: (new Intl.NumberFormat('en-US', {
					style: 'currency',
					currency: opts.currency ?? 'USD',
					currencyDisplay: 'narrowSymbol'
				})
					.formatToParts(0)
					.find((p) => p.type === 'currency')?.value ?? '$');
	return { sign, symbol, whole, fraction };
}

// ---------------------------------------------------------------------------
// Container numbers (ISO 6346): 4 letters (owner code + category), 6 digits, check digit.
// Displayed as "MSCU 123456-7" in mono.
// ---------------------------------------------------------------------------

const LETTER_VALUES: Record<string, number> = (() => {
	const map: Record<string, number> = {};
	let v = 10;
	for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
		if (v % 11 === 0) v++;
		map[ch] = v;
		v++;
	}
	return map;
})();

export function normalizeContainerNumber(raw: string): string {
	return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** ISO 6346 check digit for the first 10 characters, or null if malformed. */
export function containerCheckDigit(first10: string): number | null {
	const s = normalizeContainerNumber(first10).slice(0, 10);
	if (!/^[A-Z]{4}\d{6}$/.test(s)) return null;
	let sum = 0;
	for (let i = 0; i < 10; i++) {
		const ch = s[i];
		const val = i < 4 ? LETTER_VALUES[ch] : Number(ch);
		sum += val * 2 ** i;
	}
	return (sum % 11) % 10;
}

export function isValidContainerNumber(raw: string): boolean {
	const s = normalizeContainerNumber(raw);
	if (!/^[A-Z]{3}[UJZR]\d{7}$/.test(s)) return false;
	return containerCheckDigit(s) === Number(s[10]);
}

export function parseContainerNumber(raw: string): {
	owner: string;
	serial: string;
	check: string;
	formatted: string;
	valid: boolean;
} {
	const s = normalizeContainerNumber(raw);
	const owner = s.slice(0, 4);
	const serial = s.slice(4, 10);
	const check = s.slice(10, 11);
	const formatted = check ? `${owner} ${serial}-${check}` : serial ? `${owner} ${serial}` : owner;
	return { owner, serial, check, formatted, valid: isValidContainerNumber(s) };
}

export function formatContainerNumber(raw: string): string {
	return parseContainerNumber(raw).formatted;
}

// ---------------------------------------------------------------------------
// Hashes and addresses
// ---------------------------------------------------------------------------

/** "0x8f3a…c41e". Keeps the 0x prefix plus `head` chars, and `tail` chars. */
export function truncateMiddle(value: string, head = 6, tail = 4): string {
	if (!value) return '';
	const prefix = value.startsWith('0x') ? '0x' : '';
	const body = prefix ? value.slice(2) : value;
	if (body.length <= head + tail + 1) return value;
	return `${prefix}${body.slice(0, head)}…${body.slice(-tail)}`;
}

// ---------------------------------------------------------------------------
// Dates and times. Day-month-year everywhere (no 10/11 ambiguity across regions).
// ---------------------------------------------------------------------------

export function toDate(d: DateInput): Date {
	return d instanceof Date ? d : new Date(d);
}

/** "11 Oct 2026" */
export function formatDate(d: DateInput): string {
	return new Intl.DateTimeFormat('en-GB', {
		day: 'numeric',
		month: 'short',
		year: 'numeric'
	}).format(toDate(d));
}

/** "11 Oct 2026, 14:32" (24h, viewer's local time). */
export function formatDateTime(d: DateInput, opts: { seconds?: boolean } = {}): string {
	return new Intl.DateTimeFormat('en-GB', {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		second: opts.seconds ? '2-digit' : undefined,
		hour12: false
	}).format(toDate(d));
}

/** "14:32:07.482" for on-chain events where sub-second finality matters. */
export function formatTimestamp(d: DateInput, opts: { ms?: boolean } = { ms: true }): string {
	const date = toDate(d);
	const base = new Intl.DateTimeFormat('en-GB', {
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false
	}).format(date);
	return opts.ms ? `${base}.${String(date.getMilliseconds()).padStart(3, '0')}` : base;
}

/** Full ISO string for title attributes and <time datetime>. */
export function isoString(d: DateInput): string {
	return toDate(d).toISOString();
}

/** "482 ms" under a second, "1.24 s" above. */
export function formatFinality(ms: number): string {
	if (ms < 1000) return `${Math.round(ms)} ms`;
	return `${(ms / 1000).toFixed(2)} s`;
}

export interface DurationParts {
	days: number;
	hours: number;
	minutes: number;
	seconds: number;
}

export function durationParts(ms: number): DurationParts {
	const total = Math.max(0, Math.floor(Math.abs(ms) / 1000));
	return {
		days: Math.floor(total / 86400),
		hours: Math.floor((total % 86400) / 3600),
		minutes: Math.floor((total % 3600) / 60),
		seconds: total % 60
	};
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * clock: "4d 06:12:09"   short: "4d 6h"   long: "4 days 6 hours"
 */
export function formatDuration(ms: number, style: 'clock' | 'short' | 'long' = 'short'): string {
	const { days, hours, minutes, seconds } = durationParts(ms);
	if (style === 'clock') {
		const hms = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
		return days > 0 ? `${days}d ${hms}` : hms;
	}
	if (style === 'long') {
		const parts: string[] = [];
		if (days) parts.push(`${days} ${days === 1 ? 'day' : 'days'}`);
		if (hours) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
		if (!days && minutes) parts.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`);
		if (!parts.length) parts.push(`${seconds} ${seconds === 1 ? 'second' : 'seconds'}`);
		return parts.slice(0, 2).join(' ');
	}
	if (days) return hours ? `${days}d ${hours}h` : `${days}d`;
	if (hours) return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
	if (minutes) return `${minutes}m`;
	return `${seconds}s`;
}

/** "3 min ago", "in 2 days", "just now". */
export function formatRelative(d: DateInput, now: number = Date.now()): string {
	const diff = toDate(d).getTime() - now;
	const abs = Math.abs(diff);
	if (abs < 10_000) return 'just now';
	const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' });
	const table: [Intl.RelativeTimeFormatUnit, number][] = [
		['day', 86_400_000],
		['hour', 3_600_000],
		['minute', 60_000],
		['second', 1000]
	];
	for (const [unit, size] of table) {
		if (abs >= size || unit === 'second') return rtf.format(Math.round(diff / size), unit);
	}
	return '';
}

/** "1 day" / "7 days" */
export function formatDays(n: number): string {
	return `${n} ${n === 1 ? 'day' : 'days'}`;
}

export function formatPercent(fraction: number, digits = 0): string {
	return new Intl.NumberFormat('en-US', {
		style: 'percent',
		maximumFractionDigits: digits
	}).format(fraction);
}

export function formatCount(n: number): string {
	return new Intl.NumberFormat('en-US').format(n);
}
