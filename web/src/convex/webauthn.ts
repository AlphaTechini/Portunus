/**
 * WebAuthn assertion verification for passkey sign-in and approvals.
 * Uses `WebAuthnP256.verify` from ox, which is pure JS and runs in the default Convex runtime.
 */
import * as WebAuthnP256 from 'ox/WebAuthnP256';
import { env } from './helpers';

export interface AssertionFields {
	/** Hex of the authenticator data. */
	authenticatorData: string;
	/** The clientDataJSON string. */
	clientDataJSON: string;
	/** ECDSA signature halves, hex ('0x...') or decimal strings. */
	signatureR: string;
	signatureS: string;
	userVerificationRequired?: boolean;
}

/** Stored passkey public keys are 64 bytes (x || y), hex, no 0x04 prefix. */
function toPublicKey(hex: string): { prefix: 4; x: bigint; y: bigint } {
	const h = hex.startsWith('0x') ? hex.slice(2) : hex;
	if (h.length !== 128) throw new Error('Passkey public key must be 64 bytes');
	return { prefix: 4, x: BigInt(`0x${h.slice(0, 64)}`), y: BigInt(`0x${h.slice(64)}`) };
}

/**
 * Verify a WebAuthn assertion over `challenge` (a 0x-hex string, the exact bytes the browser
 * passed to navigator.credentials.get). Throws on malformed input, returns false on a bad signature.
 */
export function verifyAssertion(args: { publicKeyHex: string; challenge: string; assertion: AssertionFields }): boolean {
	const { publicKeyHex, challenge, assertion } = args;
	const rpId = env('PASSKEY_RP_ID');
	const origins = env('PASSKEY_ORIGINS');
	return WebAuthnP256.verify({
		challenge: challenge as `0x${string}`,
		publicKey: toPublicKey(publicKeyHex),
		metadata: {
			authenticatorData: assertion.authenticatorData as `0x${string}`,
			clientDataJSON: assertion.clientDataJSON,
			userVerificationRequired: assertion.userVerificationRequired ?? false
		} as WebAuthnP256.verify.Options['metadata'],
		signature: { r: BigInt(assertion.signatureR), s: BigInt(assertion.signatureS) },
		...(rpId ? { rpId } : {}),
		...(origins ? { origin: origins.split(',').map((s) => s.trim()) } : {})
	} as WebAuthnP256.verify.Options);
}
