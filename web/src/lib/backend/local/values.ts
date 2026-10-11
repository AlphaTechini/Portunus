/**
 * Convex value helpers for the in-browser runtime: cloning, ordering, equality.
 * Pure TS, no browser or Svelte imports.
 */

export type ConvexValue =
	| null
	| bigint
	| number
	| boolean
	| string
	| ArrayBuffer
	| ConvexValue[]
	| { [key: string]: ConvexValue };

function isPlainObject(v: unknown): v is Record<string, unknown> {
	if (typeof v !== 'object' || v === null) return false;
	const proto = Object.getPrototypeOf(v);
	return proto === Object.prototype || proto === null;
}

/**
 * Deep clone a Convex value. Mirrors what `convexToJson` accepts: object fields set to
 * `undefined` are dropped, `undefined` inside arrays and at the top level throws, and
 * only plain objects, arrays, ArrayBuffer and scalars are allowed.
 */
export function cloneValue<T = unknown>(value: T, path = ''): T {
	return cloneInner(value, path) as T;
}

function cloneInner(value: unknown, path: string): unknown {
	switch (typeof value) {
		case 'string':
		case 'boolean':
		case 'number':
		case 'bigint':
			return value;
		case 'undefined':
			throw new Error(
				`undefined is not a valid Convex value${path ? ` (present at path ${path})` : ''}. ` +
					`To learn about Convex's supported types, see https://docs.convex.dev/using/types.`
			);
		case 'object': {
			if (value === null) return null;
			if (Array.isArray(value)) {
				const out = new Array(value.length);
				for (let i = 0; i < value.length; i++) out[i] = cloneInner(value[i], `${path}[${i}]`);
				return out;
			}
			if (value instanceof ArrayBuffer) return value.slice(0);
			if (isPlainObject(value)) {
				const out: Record<string, unknown> = {};
				for (const k of Object.keys(value)) {
					const v = value[k];
					if (v !== undefined) out[k] = cloneInner(v, `${path}.${k}`);
				}
				return out;
			}
			const name = (value as object).constructor?.name;
			throw new Error(
				`${name ? name + ' ' : ''}is not a supported Convex type${path ? ` (present at path ${path})` : ''}.`
			);
		}
		default:
			throw new Error(
				`${typeof value} is not a supported Convex type${path ? ` (present at path ${path})` : ''}.`
			);
	}
}

/** Type rank in Convex's total order: undefined < null < int64 < float64 < boolean < string < bytes < array < object. */
function rank(v: unknown): number {
	if (v === undefined) return 0;
	if (v === null) return 1;
	switch (typeof v) {
		case 'bigint':
			return 2;
		case 'number':
			return 3;
		case 'boolean':
			return 4;
		case 'string':
			return 5;
	}
	if (v instanceof ArrayBuffer) return 6;
	if (Array.isArray(v)) return 7;
	return 8;
}

function cmp<T>(a: T, b: T): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

export function compareValues(a: unknown, b: unknown): number {
	const ra = rank(a);
	const rb = rank(b);
	if (ra !== rb) return ra < rb ? -1 : 1;
	switch (ra) {
		case 0:
		case 1:
			return 0;
		case 2:
		case 4:
			return cmp(a as bigint | boolean, b as bigint | boolean);
		case 3: {
			const x = a as number;
			const y = b as number;
			if (Number.isNaN(x) || Number.isNaN(y)) {
				return Number.isNaN(x) ? (Number.isNaN(y) ? 0 : 1) : -1;
			}
			if (x === y) {
				if (x === 0) {
					const nx = Object.is(x, -0);
					const ny = Object.is(y, -0);
					return nx === ny ? 0 : nx ? -1 : 1;
				}
				return 0;
			}
			return x < y ? -1 : 1;
		}
		case 5:
			return cmp(a as string, b as string);
		case 6: {
			const x = new Uint8Array(a as ArrayBuffer);
			const y = new Uint8Array(b as ArrayBuffer);
			const n = Math.min(x.length, y.length);
			for (let i = 0; i < n; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
			return cmp(x.length, y.length);
		}
		case 7: {
			const x = a as unknown[];
			const y = b as unknown[];
			const n = Math.min(x.length, y.length);
			for (let i = 0; i < n; i++) {
				const c = compareValues(x[i], y[i]);
				if (c !== 0) return c;
			}
			return cmp(x.length, y.length);
		}
		default: {
			const x = a as Record<string, unknown>;
			const y = b as Record<string, unknown>;
			const kx = Object.keys(x)
				.filter((k) => x[k] !== undefined)
				.sort();
			const ky = Object.keys(y)
				.filter((k) => y[k] !== undefined)
				.sort();
			const n = Math.min(kx.length, ky.length);
			for (let i = 0; i < n; i++) {
				const ck = cmp(kx[i], ky[i]);
				if (ck !== 0) return ck;
				const cv = compareValues(x[kx[i]], y[ky[i]]);
				if (cv !== 0) return cv;
			}
			return cmp(kx.length, ky.length);
		}
	}
}

export function valuesEqual(a: unknown, b: unknown): boolean {
	return compareValues(a, b) === 0;
}

/** Read a (possibly dotted) field path from a document. */
export function getField(doc: unknown, path: string): unknown {
	if (path.indexOf('.') === -1) {
		return doc == null ? undefined : (doc as Record<string, unknown>)[path];
	}
	let cur: unknown = doc;
	for (const part of path.split('.')) {
		if (cur === null || typeof cur !== 'object') return undefined;
		cur = (cur as Record<string, unknown>)[part];
	}
	return cur;
}

/** Stable JSON-ish key for a Convex value, used to key subscriptions by args. */
export function stableKey(value: unknown): string {
	return JSON.stringify(value, (_k, v) => {
		if (typeof v === 'bigint') return { $b: v.toString() };
		if (v instanceof ArrayBuffer) return { $y: Array.from(new Uint8Array(v)) };
		if (typeof v === 'number' && !Number.isFinite(v)) return { $n: String(v) };
		if (v && typeof v === 'object' && !Array.isArray(v)) {
			const out: Record<string, unknown> = {};
			for (const k of Object.keys(v).sort()) if (v[k] !== undefined) out[k] = v[k];
			return out;
		}
		return v;
	});
}
