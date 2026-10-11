import { describe, expect, it } from 'vitest';
import { P256, WebAuthnP256 } from 'ox';
import { PublicKey } from 'viem/tempo';
import { verifyPasskeyAssertion, type PasskeyAssertion } from './passkey';
import type { Hex } from './constants';

// A software authenticator: produces the same assertion shape the browser module sends to Convex.
function assert(challenge: Hex, rpId: string, privateKey: Hex): PasskeyAssertion {
	const { metadata, payload } = WebAuthnP256.getSignPayload({
		challenge,
		origin: `https://${rpId}`,
		rpId,
		userVerification: 'required'
	});
	const sig = P256.sign({ payload, privateKey, hash: true });
	const pad = (n: bigint) => `0x${n.toString(16).padStart(64, '0')}` as Hex;
	return {
		credentialId: 'cred-1',
		challenge,
		signature: { r: pad(sig.r), s: pad(sig.s) },
		metadata
	};
}

describe('passkey assertion verification', () => {
	const privateKey = P256.randomPrivateKey();
	const publicKey = PublicKey.toHex(P256.getPublicKey({ privateKey }), { includePrefix: false });
	const challenge = `0x${'5a'.repeat(32)}` as Hex;

	it('accepts a valid assertion', () => {
		const a = assert(challenge, 'localhost', privateKey);
		expect(verifyPasskeyAssertion(a, publicKey, { rpId: 'localhost' })).toBe(true);
	});

	it('rejects a wrong rpId, a wrong challenge and a different key', () => {
		const a = assert(challenge, 'localhost', privateKey);
		expect(verifyPasskeyAssertion(a, publicKey, { rpId: 'evil.example' })).toBe(false);
		expect(verifyPasskeyAssertion({ ...a, challenge: `0x${'00'.repeat(32)}` }, publicKey)).toBe(
			false
		);
		const other = PublicKey.toHex(P256.getPublicKey({ privateKey: P256.randomPrivateKey() }), {
			includePrefix: false
		});
		expect(verifyPasskeyAssertion(a, other)).toBe(false);
	});

	it('survives a JSON round trip (the Convex boundary)', () => {
		const a = JSON.parse(JSON.stringify(assert(challenge, 'localhost', privateKey)));
		expect(verifyPasskeyAssertion(a, publicKey, { origin: 'https://localhost' })).toBe(true);
	});
});
