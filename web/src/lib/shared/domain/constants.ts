/**
 * Chain constants shared by the sim, the live adapter and the UI.
 * Values come from docs/research/tempo-integration.md section 1.
 */

export const CHAIN_ID = 42431;
export const CHAIN_NAME = 'Tempo Moderato';
export const EXPLORER_URL = 'https://explore.testnet.tempo.xyz';
export const TOKEN_DECIMALS = 6;

export const PATH_USD = '0x20c0000000000000000000000000000000000000' as const;
export const ALPHA_USD = '0x20c0000000000000000000000000000000000001' as const;
export const BETA_USD = '0x20c0000000000000000000000000000000000002' as const;

/** The token used for deposits, charges and refunds. */
export const SETTLEMENT_TOKEN = ALPHA_USD;

export const TOKEN_SYMBOLS: Record<string, string> = {
	[PATH_USD]: 'pathUSD',
	[ALPHA_USD]: 'AlphaUSD',
	[BETA_USD]: 'BetaUSD'
};

export type TokenSymbol = 'AlphaUSD' | 'BetaUSD' | 'pathUSD';

export const TOKEN_BY_SYMBOL: Record<TokenSymbol, `0x${string}`> = {
	AlphaUSD: ALPHA_USD,
	BetaUSD: BETA_USD,
	pathUSD: PATH_USD
};

export function tokenSymbol(address: string): string {
	return TOKEN_SYMBOLS[address.toLowerCase()] ?? 'Unknown token';
}

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

/** Precompile addresses (brief section 1). */
export const RECEIVE_POLICY_GUARD = '0xB10C000000000000000000000000000000000000' as const;
export const ACCOUNT_KEYCHAIN = '0xaAAAaaAA00000000000000000000000000000000' as const;

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;
export const DAY_SEC = 86_400;

export const DEFAULT_SETTLEMENT_WINDOW_DAYS = 3;
export const DEFAULT_CLEAN_RETURNS_FOR_DEPOSIT_FREE = 3;
export const DEFAULT_MAX_DETENTION_DAYS = 30;
/** Time the line gets to issue the release order after the importer authorizes a key. */
export const DEFAULT_RELEASE_ALLOWANCE_DAYS = 3;
/** The silent-line rule: the line has this long after the empty's return date to record it itself. */
export const DEFAULT_SILENT_GRACE_HOURS = 24;
