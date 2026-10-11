// Browser-only passkeys (WebAuthn P-256) for Tempo root accounts.
// Every function touches `window`, so call them from event handlers or onMount, never during SSR.
// Passkeys are bound to the rpId (the page hostname). Use http://localhost:5173, never 127.0.0.1, because
// WebAuthn rejects IP-address RP IDs. A passkey created on one hostname does not work on another.
import { Account, WebAuthnP256 } from 'viem/tempo';
import { stringToHex, type Hex as ViemHex } from 'viem';
import type { Address, Hex } from '../shared/tempo/live/constants';
import type { PasskeyAssertion } from '../shared/tempo/live/passkey';

export type { PasskeyAssertion };

export type PasskeyErrorCode =
	| 'SSR' // called on the server
	| 'UNSUPPORTED' // browser or device without WebAuthn
	| 'INSECURE' // not a secure context, or an IP-address host
	| 'CANCELLED' // the user dismissed the prompt or it timed out
	| 'NOT_FOUND' // no matching passkey on this device
	| 'FAILED';

export class PasskeyError extends Error {
	readonly code: PasskeyErrorCode;
	constructor(code: PasskeyErrorCode, message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = 'PasskeyError';
		this.code = code;
	}
}

/** Identifies a registered passkey: enough to rebuild the Tempo account and to prompt for it. */
export interface PasskeyRef {
	credentialId: string;
	/** 64-byte x||y hex, as returned by createPasskey and stored on the user record. */
	publicKey: Hex;
}

export interface PasskeyCredential extends PasskeyRef {
	/** The Tempo account address derived from the public key. */
	address: Address;
}

export interface PasskeySignature extends PasskeyAssertion {
	/** r||s as one 64-byte hex. */
	signatureHex: Hex;
}

// ---------------------------------------------------------------------------------------------------------------

export function isPasskeySupported(): boolean {
	return (
		typeof window !== 'undefined' &&
		typeof window.PublicKeyCredential !== 'undefined' &&
		typeof navigator !== 'undefined' &&
		!!navigator.credentials
	);
}

/** rpId = page hostname. Throws a clear PasskeyError when WebAuthn cannot work on this page. */
export function passkeyRpId(): string {
	if (typeof window === 'undefined') {
		throw new PasskeyError('SSR', 'Passkeys can only be used in the browser.');
	}
	if (!isPasskeySupported()) {
		throw new PasskeyError(
			'UNSUPPORTED',
			'This browser or device does not support passkeys. Try a current version of Chrome, Safari or Edge.'
		);
	}
	const host = window.location.hostname;
	if (!window.isSecureContext) {
		throw new PasskeyError(
			'INSECURE',
			'Passkeys need a secure page. Open the app over HTTPS, or at http://localhost.'
		);
	}
	if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) {
		throw new PasskeyError(
			'INSECURE',
			`Passkeys do not work on an IP address (${host}). Open the app at http://localhost:<port> instead.`
		);
	}
	return host;
}

function wrap(e: unknown, what: string): PasskeyError {
	if (e instanceof PasskeyError) return e;
	// ox wraps the DOMException in its own error; walk the cause chain for the DOM error name.
	let name = '';
	let msg = '';
	let cur: unknown = e;
	for (let i = 0; i < 6 && cur && typeof cur === 'object'; i++) {
		const x = cur as { name?: string; message?: string; cause?: unknown };
		if (x.name && x.name !== 'Error') name ||= x.name;
		if (x.message) msg ||= x.message;
		if (name === 'NotAllowedError' || name === 'AbortError' || name === 'InvalidStateError') break;
		cur = x.cause;
	}
	if (name === 'NotAllowedError' || name === 'AbortError') {
		return new PasskeyError('CANCELLED', `The passkey prompt was cancelled or timed out (${what}).`, {
			cause: e
		});
	}
	if (name === 'InvalidStateError') {
		return new PasskeyError(
			'FAILED',
			'A passkey for this account already exists on this device. Sign in with it instead.',
			{ cause: e }
		);
	}
	if (name === 'SecurityError') {
		return new PasskeyError(
			'INSECURE',
			'The browser refused the passkey for this site. Use HTTPS or http://localhost (not an IP address).',
			{ cause: e }
		);
	}
	if (name === 'NotSupportedError') {
		return new PasskeyError('UNSUPPORTED', 'This device does not support the required passkey type.', {
			cause: e
		});
	}
	return new PasskeyError('FAILED', `Passkey ${what} failed${msg ? `: ${msg}` : '.'}`, { cause: e });
}

/** Rebuilds the (non-serializable) Tempo account for a stored passkey. Signing prompts the user. */
export function accountFromPasskey(p: PasskeyRef) {
	return Account.fromWebAuthnP256(
		{ id: p.credentialId, publicKey: p.publicKey as ViemHex },
		{ rpId: passkeyRpId() }
	);
}

/**
 * Creates a discoverable passkey and derives its Tempo address (last 20 bytes of keccak256(x||y)).
 * The public key cannot be recovered from the credential later: store it (auth.registerPasskey).
 */
export async function createPasskey(label: string): Promise<PasskeyCredential> {
	const rpId = passkeyRpId();
	try {
		const cred = await WebAuthnP256.createCredential({
			label,
			userId: crypto.getRandomValues(new Uint8Array(32)),
			rpId
		});
		const account = Account.fromWebAuthnP256({ id: cred.id, publicKey: cred.publicKey });
		return { credentialId: cred.id, publicKey: cred.publicKey, address: account.address };
	} catch (e) {
		throw wrap(e, 'creation');
	}
}

const toChallengeHex = (c: string): Hex => (/^0x[0-9a-fA-F]*$/.test(c) ? (c as Hex) : (stringToHex(c) as Hex));
const pad32 = (n: bigint): Hex => `0x${n.toString(16).padStart(64, '0')}`;

/**
 * Prompts for a passkey and signs `hash` (a WebAuthn challenge). Returns the assertion plus, if
 * `getPublicKey` is given, the stored public key looked up by credential id.
 */
async function signHash(
	hash: Hex,
	opts: {
		credentialId?: string;
		getPublicKey?: (credentialId: string) => Promise<Hex | null | undefined>;
		what: string;
	}
): Promise<PasskeySignature & { publicKey: Hex | null }> {
	const rpId = passkeyRpId();
	let publicKey: Hex | null = null;
	try {
		const c = await WebAuthnP256.getCredential({
			hash,
			rpId,
			...(opts.credentialId ? { credentialId: opts.credentialId } : {}),
			getPublicKey: async (raw) => {
				publicKey = (await opts.getPublicKey?.(raw.id)) ?? null;
				return (publicKey ?? '0x') as ViemHex;
			}
		});
		const r = pad32(c.signature.r);
		const s = pad32(c.signature.s);
		return {
			credentialId: c.id,
			challenge: hash,
			signature: { r, s },
			signatureHex: `0x${r.slice(2)}${s.slice(2)}`,
			metadata: c.metadata,
			publicKey
		};
	} catch (e) {
		throw wrap(e, opts.what);
	}
}

/**
 * Passkey sign-in: prompts the user to pick a passkey (discoverable) and signs the server challenge.
 * Send the result to `auth.signInWithPasskey`. If you pass `getPublicKey` (for example a call to
 * `auth.passkeyPublicKey`), the returned `publicKey` is the stored key for the chosen credential.
 * `challenge` should be 0x hex; any other string is hex-encoded as UTF-8 and the encoded value is returned
 * as `challenge`.
 */
export async function getPasskeyAssertion(
	challenge: string,
	opts: { getPublicKey?: (credentialId: string) => Promise<Hex | null | undefined> } = {}
): Promise<PasskeySignature & { publicKey: Hex | null }> {
	return signHash(toChallengeHex(challenge), { ...opts, what: 'sign-in' });
}

/**
 * Sim mode approval: a real WebAuthn prompt over a payload hash (the sim transaction hash), so the demo
 * UX is identical to live. Restricted to the user's own credential. Returns the assertion to store as proof.
 */
export async function approveWithPasskey(
	payloadHash: string,
	credential?: { credentialId: string }
): Promise<PasskeySignature> {
	const r = await signHash(toChallengeHex(payloadHash), {
		credentialId: credential?.credentialId,
		what: 'approval'
	});
	return {
		credentialId: r.credentialId,
		challenge: r.challenge,
		signature: r.signature,
		signatureHex: r.signatureHex,
		metadata: r.metadata
	};
}
