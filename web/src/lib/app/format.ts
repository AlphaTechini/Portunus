/**
 * Formatting for pages. Everything in `#lib/ui` format.ts is re-exported, plus helpers for the
 * shapes the backend returns (money as base-unit decimal strings, ms timestamps).
 *
 *   <Money amount={units(container.depositUnits)} size="xl" />
 */
export * from '../ui/format';
import { formatRelative } from '../ui/format';

/** Backend money (decimal string of 6-decimal base units) to the bigint that `<Money>` and `formatMoney` take. */
export function units(value: string | bigint | number | null | undefined): bigint {
	if (value === null || value === undefined || value === '') return 0n;
	if (typeof value === 'bigint') return value;
	try {
		return BigInt(value);
	} catch {
		return 0n;
	}
}

/** Sum of base-unit strings. */
export function sumUnits(values: (string | bigint | null | undefined)[]): bigint {
	return values.reduce<bigint>((t, v) => t + units(v), 0n);
}

/** "3 min ago" relative to the product clock (pass `app.now()`), so it stays right after the demo clock moves. */
export function relativeToProduct(ts: number, productNow: number): string {
	return formatRelative(ts, productNow);
}
