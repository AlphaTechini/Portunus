/**
 * Document ids for the in-browser runtime.
 *
 * An id is 32 base32 characters. The first two encode the table number (looked up in a
 * persisted registry), the rest is random. This makes `db.get(id)` and `db.normalizeId`
 * able to find the table without a scan, like real Convex ids.
 */

const ALPHABET = '0123456789abcdefghijklmnopqrstuv';
const ID_LENGTH = 32;
const TABLE_CHARS = 2;

export class TableRegistry {
	/** table name -> number */
	nums: Record<string, number> = {};
	private rev = new Map<number, string>();

	constructor(initial?: Record<string, number>) {
		if (initial) {
			for (const [name, n] of Object.entries(initial)) this.set(name, n);
		}
	}

	private set(name: string, n: number) {
		this.nums[name] = n;
		this.rev.set(n, name);
	}

	/** Get (or assign) the number for a table. Assignment is deterministic: next free number. */
	numberFor(name: string): number {
		const existing = this.nums[name];
		if (existing !== undefined) return existing;
		let n = 1;
		while (this.rev.has(n)) n++;
		if (n >= 32 * 32) throw new Error('Too many tables for the local runtime');
		this.set(name, n);
		return n;
	}

	nameFor(n: number): string | undefined {
		return this.rev.get(n);
	}

	has(name: string): boolean {
		return this.nums[name] !== undefined;
	}

	/** Adopt persisted assignments (they win, existing ids encode them); keep our extra tables. */
	adopt(persisted: Record<string, number>) {
		const mine = Object.keys(this.nums).sort((a, b) => this.nums[a] - this.nums[b]);
		this.nums = {};
		this.rev.clear();
		for (const [name, n] of Object.entries(persisted)) this.set(name, n);
		for (const name of mine) this.numberFor(name);
	}
}

function randomChars(n: number): string {
	const bytes = new Uint8Array(n);
	const c = (globalThis as { crypto?: Crypto }).crypto;
	if (c?.getRandomValues) c.getRandomValues(bytes);
	else for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
	let out = '';
	for (let i = 0; i < n; i++) out += ALPHABET[bytes[i] & 31];
	return out;
}

export function makeId(registry: TableRegistry, table: string): string {
	const n = registry.numberFor(table);
	return ALPHABET[n >> 5] + ALPHABET[n & 31] + randomChars(ID_LENGTH - TABLE_CHARS);
}

/** Decode the table an id belongs to, or null if the string is not a valid local id. */
export function tableOfId(registry: TableRegistry, id: unknown): string | null {
	if (typeof id !== 'string' || id.length !== ID_LENGTH) return null;
	for (let i = 0; i < id.length; i++) if (ALPHABET.indexOf(id[i]) === -1) return null;
	const n = ALPHABET.indexOf(id[0]) * 32 + ALPHABET.indexOf(id[1]);
	return registry.nameFor(n) ?? null;
}
