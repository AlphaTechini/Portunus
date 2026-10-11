// Error classification for Tempo precompile reverts. viem's ExecutionError.from did not decode the bare
// AccountKeychain selectors offline, so match on text and selector across the whole cause chain.

/** AccountKeychain custom errors we care about (selectors verified with viem toFunctionSelector). */
export const KEYCHAIN_ERROR_SELECTORS = {
	SpendingLimitExceeded: '0xe9a36a4b',
	CallNotAllowed: '0x90800d35',
	KeyExpired: '0x403ac939',
	KeyAlreadyRevoked: '0x6e143480',
	UnauthorizedCaller: '0x5fc755d3'
} as const;

export type KeychainErrorName = keyof typeof KEYCHAIN_ERROR_SELECTORS;

/** Flattens an error and its causes into one searchable string. */
export function errorText(e: unknown): string {
	const parts: string[] = [];
	const seen = new Set<unknown>();
	let cur: unknown = e;
	for (let i = 0; i < 8 && cur && typeof cur === 'object' && !seen.has(cur); i++) {
		seen.add(cur);
		const x = cur as Record<string, unknown>;
		for (const k of ['shortMessage', 'message', 'details', 'data', 'name', 'reason']) {
			const val = x[k];
			if (typeof val === 'string') parts.push(val);
		}
		if (Array.isArray(x.metaMessages)) parts.push(x.metaMessages.join(' '));
		const err = x.error;
		if (err && typeof err === 'object') {
			const ee = err as Record<string, unknown>;
			if (typeof ee.message === 'string') parts.push(ee.message);
			if (typeof ee.data === 'string') parts.push(ee.data);
		}
		cur = x.cause;
	}
	if (typeof e === 'string') parts.push(e);
	return parts.join(' ');
}

export function keychainErrorOf(e: unknown): KeychainErrorName | null {
	const text = errorText(e);
	for (const [name, selector] of Object.entries(KEYCHAIN_ERROR_SELECTORS)) {
		if (new RegExp(`${name}|${selector}`, 'i').test(text)) return name as KeychainErrorName;
	}
	return null;
}

export const isLimitExceeded = (e: unknown): boolean =>
	keychainErrorOf(e) === 'SpendingLimitExceeded';

/** The public RPC rate-limits in bursts; viem retries but may give up. */
export const isRpcRateLimit = (e: unknown): boolean =>
	/exceeds defined limit|rate limit|too many requests/i.test(errorText(e));

/** Short, user-presentable description of a failed live call. */
export function describeChainError(e: unknown): string {
	const k = keychainErrorOf(e);
	if (k) return `Refused by the chain: ${k}`;
	const x = e as { shortMessage?: string; message?: string } | undefined;
	return (x?.shortMessage ?? x?.message ?? String(e)).split('\n')[0].slice(0, 300);
}
