// AES-256-GCM for access-key private keys at rest (Convex table `accessKeys.encPrivKey`).
// Uses WebCrypto only, so the same code runs in Node 20+ (Convex actions), the browser and vitest.
// Format: "v1.<base64url iv>.<base64url ciphertext||tag>".

const subtle = (): SubtleCrypto => {
	const c = (globalThis as { crypto?: Crypto }).crypto;
	if (!c?.subtle) throw new Error('WebCrypto (crypto.subtle) is not available in this runtime');
	return c.subtle;
};

const b64u = {
	enc(bytes: Uint8Array): string {
		let s = '';
		for (const b of bytes) s += String.fromCharCode(b);
		return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
	},
	dec(str: string): Uint8Array {
		const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
		const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad);
		const out = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
		return out;
	}
};

/** Parses a 32-byte key given as hex (with or without 0x) or base64/base64url. */
export function parseEncryptionKey(raw: string): Uint8Array {
	const s = raw.trim();
	const hex = s.startsWith('0x') ? s.slice(2) : s;
	if (/^[0-9a-fA-F]{64}$/.test(hex)) {
		const out = new Uint8Array(32);
		for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
		return out;
	}
	try {
		const bytes = b64u.dec(s);
		if (bytes.length === 32) return bytes;
	} catch {
		// fall through to the error below
	}
	throw new Error('ACCESS_KEY_ENC_KEY must be 32 bytes, given as 64 hex characters or base64');
}

async function importKey(rawKey: string) {
	// Copy into a fresh ArrayBuffer-backed view: keeps TS happy about BufferSource.
	const bytes = parseEncryptionKey(rawKey);
	return subtle().importKey('raw', new Uint8Array(bytes), { name: 'AES-GCM' }, false, [
		'encrypt',
		'decrypt'
	]);
}

export async function encryptSecret(plaintext: string, rawKey: string): Promise<string> {
	const key = await importKey(rawKey);
	const iv = new Uint8Array(12);
	globalThis.crypto.getRandomValues(iv);
	const ct = new Uint8Array(
		await subtle().encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext))
	);
	return `v1.${b64u.enc(iv)}.${b64u.enc(ct)}`;
}

export async function decryptSecret(payload: string, rawKey: string): Promise<string> {
	const [version, ivPart, ctPart] = payload.split('.');
	if (version !== 'v1' || !ivPart || !ctPart) throw new Error('unrecognised encrypted secret format');
	const key = await importKey(rawKey);
	try {
		const pt = await subtle().decrypt(
			{ name: 'AES-GCM', iv: new Uint8Array(b64u.dec(ivPart)) },
			key,
			new Uint8Array(b64u.dec(ctPart))
		);
		return new TextDecoder().decode(pt);
	} catch {
		throw new Error('could not decrypt secret (wrong ACCESS_KEY_ENC_KEY or corrupted value)');
	}
}
