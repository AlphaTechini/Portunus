/**
 * WebAuthn assertion verification for passkey sign-in and approvals.
 * Uses `WebAuthnP256.verify` from ox, which is pure JS and runs in the default Convex runtime.
 */
import { v } from 'convex/values';
import * as WebAuthnP256 from 'ox/WebAuthnP256';
import type { Doc } from './_generated/dataModel';
import { appError, checkApprovalMethod, env, type Approval } from './helpers';

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

/** Convex validator for the `approval` argument of payBatch and accessKeys.authorize. */
export const approvalV = v.object({
	method: v.union(v.literal('passkey'), v.literal('demo')),
	credentialId: v.optional(v.string()),
	/** Must equal the `payloadHash` returned by the matching preview/prepare query. */
	payloadHash: v.optional(v.string()),
	/** WebAuthn assertion over `payloadHash` as the challenge. Verified when present. */
	assertion: v.optional(
		v.object({
			authenticatorData: v.string(),
			clientDataJSON: v.string(),
			signatureR: v.string(),
			signatureS: v.string(),
			userVerificationRequired: v.optional(v.boolean())
		})
	)
});

/**
 * Validate how the user approved a payment or authorization. Returns how it was approved.
 * A passkey approval with an assertion is cryptographically verified; without one it is accepted
 * as demo-grade (the browser still showed the real WebAuthn prompt).
 */
export function checkApproval(
	user: Doc<'users'>,
	approval: Approval,
	expectedPayloadHash: string
): { approvedWith: 'passkey' | 'demo'; verified: boolean } {
	const approvedWith = checkApprovalMethod(user, approval);
	if (approval.payloadHash && approval.payloadHash.toLowerCase() !== expectedPayloadHash.toLowerCase()) {
		throw appError('APPROVAL_REQUIRED', 'This request changed after you reviewed it. Review and approve again.');
	}
	if (approvedWith === 'passkey' && approval.assertion && user.passkey) {
		const a = approval.assertion as AssertionFields;
		let ok = false;
		try {
			ok = verifyAssertion({ publicKeyHex: user.passkey.publicKey, challenge: expectedPayloadHash, assertion: a });
		} catch {
			ok = false;
		}
		if (!ok) throw appError('APPROVAL_REQUIRED', 'The passkey approval could not be verified.');
		return { approvedWith, verified: true };
	}
	return { approvedWith, verified: false };
}
