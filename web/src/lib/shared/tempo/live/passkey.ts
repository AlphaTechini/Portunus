// Passkey (WebAuthn P-256) assertion types and server-side verification. Pure: no browser APIs, so Convex can
// import it to check what the browser module (src/lib/tempo/passkey.ts) produced.
import { PublicKey } from 'viem/tempo';
import { WebAuthnP256 } from 'ox';
import type { Hex } from './constants';

export interface PasskeySignMetadata {
	authenticatorData: Hex;
	clientDataJSON: string;
	challengeIndex?: number;
	typeIndex?: number;
	userVerificationRequired?: boolean;
}

/** What the browser sends to Convex after a WebAuthn prompt over `challenge`. JSON-safe. */
export interface PasskeyAssertion {
	credentialId: string;
	/** The 0x hex that was signed (the WebAuthn challenge). */
	challenge: Hex;
	/** P-256 signature, each component a 32-byte hex. */
	signature: { r: Hex; s: Hex };
	metadata: PasskeySignMetadata;
}

const toBig = (h: Hex) => BigInt(h);

/**
 * Verifies an assertion against a stored public key (64-byte x||y hex, as saved at registration).
 * Pass `rpId` (the site hostname) and/or `origin` to also bind the assertion to the site.
 */
export function verifyPasskeyAssertion(
	assertion: PasskeyAssertion,
	publicKey: Hex,
	opts: { rpId?: string; origin?: string | string[] } = {}
): boolean {
	try {
		return WebAuthnP256.verify({
			challenge: assertion.challenge,
			publicKey: PublicKey.fromHex(publicKey),
			signature: { r: toBig(assertion.signature.r), s: toBig(assertion.signature.s) },
			metadata: assertion.metadata,
			...(opts.rpId !== undefined ? { rpId: opts.rpId } : {}),
			...(opts.origin !== undefined ? { origin: opts.origin } : {})
		});
	} catch {
		return false;
	}
}
