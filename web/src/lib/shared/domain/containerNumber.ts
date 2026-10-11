/**
 * ISO 6346 container numbers: 3-letter owner code, 1 equipment category letter
 * (U, J, Z), 6-digit serial and a check digit. Display form: 'MRDU 123456 5'.
 */

const LETTER_VALUES: Record<string, number> = (() => {
	const map: Record<string, number> = {};
	let value = 10;
	for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
		if (value % 11 === 0) value++; // skip 11, 22, 33
		map[ch] = value++;
	}
	return map;
})();

export function normalizeContainerNumber(input: string): string {
	return input.replace(/[\s-]/g, '').toUpperCase();
}

function charValue(ch: string): number {
	if (ch >= '0' && ch <= '9') return ch.charCodeAt(0) - 48;
	const v = LETTER_VALUES[ch];
	if (v === undefined) throw new Error(`Invalid character in container number: ${ch}`);
	return v;
}

/** Check digit for the first 10 characters (owner + category + serial). */
export function computeCheckDigit(first10: string): number {
	const s = normalizeContainerNumber(first10);
	if (!/^[A-Z]{4}\d{6}$/.test(s))
		throw new Error(`Expected 4 letters and 6 digits, got "${first10}"`);
	let sum = 0;
	for (let i = 0; i < 10; i++) sum += charValue(s[i]) * 2 ** i;
	return (sum % 11) % 10;
}

export type ContainerNumberCheck = { ok: true; number: string } | { ok: false; reason: string };

export function checkContainerNumber(input: string): ContainerNumberCheck {
	const s = normalizeContainerNumber(input);
	if (!/^[A-Z]{3}[UJZ]\d{7}$/.test(s)) {
		return {
			ok: false,
			reason:
				'A container number is 3 owner letters, U, J or Z, then 7 digits (for example MRDU 123456 5).'
		};
	}
	const expected = computeCheckDigit(s.slice(0, 10));
	if (expected !== Number(s[10])) {
		return { ok: false, reason: `Check digit should be ${expected} for ${s.slice(0, 10)}.` };
	}
	return { ok: true, number: s };
}

export function validateContainerNumber(input: string): boolean {
	return checkContainerNumber(input).ok;
}

/** 'MRDU1234565' -> 'MRDU 123456 5' */
export function formatContainerNumber(input: string): string {
	const s = normalizeContainerNumber(input);
	if (s.length !== 11) return input;
	return `${s.slice(0, 4)} ${s.slice(4, 10)} ${s.slice(10)}`;
}

/** Build a valid number from an owner prefix (e.g. 'MRDU') and a serial. */
export function generateContainerNumber(prefix: string, serial: number): string {
	const p = prefix.toUpperCase();
	if (!/^[A-Z]{3}[UJZ]$/.test(p)) throw new Error(`Bad owner prefix: ${prefix}`);
	if (!Number.isInteger(serial) || serial < 0 || serial > 999_999)
		throw new Error(`Bad serial: ${serial}`);
	const first10 = `${p}${String(serial).padStart(6, '0')}`;
	return `${first10}${computeCheckDigit(first10)}`;
}
