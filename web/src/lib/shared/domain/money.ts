/**
 * Money helpers. AlphaUSD has 6 decimals.
 *
 * Convention used everywhere: a field called `...Units` is an integer count of
 * base units (1 USD = 1_000_000 units) stored as a decimal STRING, because
 * Convex numbers are doubles. In TS logic we use bigint. `toUnits` converts a
 * human decimal ('1200.50') to bigint base units; `fromUnits` goes back.
 */

export const DECIMALS = 6;
export const ONE_USD = 1_000_000n;

export type UnitsLike = bigint | string | number;

/** Parse a base-unit amount (bigint, integer string or safe integer) into bigint. */
export function u(value: UnitsLike): bigint {
	if (typeof value === 'bigint') return value;
	if (typeof value === 'number') {
		if (!Number.isSafeInteger(value)) throw new Error(`Not a safe integer amount: ${value}`);
		return BigInt(value);
	}
	const s = value.trim();
	if (!/^-?\d+$/.test(s)) throw new Error(`Not a base-unit integer string: "${value}"`);
	return BigInt(s);
}

/** Serialize bigint base units to the stored string form. */
export function su(value: bigint): string {
	return value.toString();
}

/** '1200.50' (or 1200.5, or '1,200.50') -> 1200500000n. Throws on more than 6 decimals or junk. */
export function toUnits(input: string | number | bigint): bigint {
	if (typeof input === 'bigint') return input * ONE_USD;
	let s = typeof input === 'number' ? numberToPlain(input) : input.trim().replace(/[,_\s]/g, '');
	s = s.replace(/^\$/, '');
	const m = /^(-)?(\d+)?(?:\.(\d+))?$/.exec(s);
	if (!m || (m[2] === undefined && m[3] === undefined)) throw new Error(`Invalid amount: "${input}"`);
	const [, neg, whole = '0', frac = ''] = m;
	if (frac.length > DECIMALS) throw new Error(`Too many decimals (max ${DECIMALS}): "${input}"`);
	const units = BigInt(whole) * ONE_USD + BigInt(frac.padEnd(DECIMALS, '0') || '0');
	return neg ? -units : units;
}

function numberToPlain(n: number): string {
	if (!Number.isFinite(n)) throw new Error(`Invalid amount: ${n}`);
	// toFixed avoids exponent notation for the ranges we care about.
	return n.toFixed(DECIMALS).replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * Base units -> decimal string with at least 2 decimals and no trailing zeros
 * beyond that: 1200500000 -> '1200.50', 1234567 -> '1.234567'.
 */
export function fromUnits(units: UnitsLike): string {
	const n = u(units);
	const neg = n < 0n;
	const abs = neg ? -n : n;
	const whole = abs / ONE_USD;
	let frac = (abs % ONE_USD).toString().padStart(DECIMALS, '0');
	frac = frac.replace(/0+$/, '');
	if (frac.length < 2) frac = frac.padEnd(2, '0');
	return `${neg ? '-' : ''}${whole}.${frac}`;
}

/** '$1,200.50'. Rounds half up to cents. */
export function formatUsd(units: UnitsLike, opts: { symbol?: boolean; cents?: boolean } = {}): string {
	const { symbol = true, cents = true } = opts;
	const n = u(units);
	const neg = n < 0n;
	const abs = neg ? -n : n;
	// round half up to cents (10_000 units per cent)
	const totalCents = (abs + 5_000n) / 10_000n;
	const dollars = totalCents / 100n;
	const c = (totalCents % 100n).toString().padStart(2, '0');
	const grouped = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
	const body = cents ? `${grouped}.${c}` : grouped;
	return `${neg ? '-' : ''}${symbol ? '$' : ''}${body}`;
}

export const addUnits = (a: UnitsLike, b: UnitsLike): string => su(u(a) + u(b));
export const subUnits = (a: UnitsLike, b: UnitsLike): string => su(u(a) - u(b));
export const minUnits = (a: UnitsLike, b: UnitsLike): string => su(u(a) < u(b) ? u(a) : u(b));
export const maxUnits = (a: UnitsLike, b: UnitsLike): string => su(u(a) > u(b) ? u(a) : u(b));
export const mulUnits = (a: UnitsLike, n: number | bigint): string => su(u(a) * BigInt(n));
export const cmpUnits = (a: UnitsLike, b: UnitsLike): -1 | 0 | 1 => {
	const x = u(a);
	const y = u(b);
	return x < y ? -1 : x > y ? 1 : 0;
};
export const sumUnits = (list: Iterable<UnitsLike>): string => {
	let t = 0n;
	for (const x of list) t += u(x);
	return su(t);
};

export const minBig = (a: bigint, b: bigint): bigint => (a < b ? a : b);
export const maxBig = (a: bigint, b: bigint): bigint => (a > b ? a : b);
