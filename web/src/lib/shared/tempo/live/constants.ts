// Network constants for Tempo Moderato testnet. Pure values, safe in Convex, Node and the browser.
export type Hex = `0x${string}`;
export type Address = Hex;

export const CHAIN_ID = 42431;
export const DEFAULT_RPC_URL = 'https://rpc.moderato.tempo.xyz';
/** Public testnet fee sponsor (no API key). Testnet only. */
export const DEFAULT_SPONSOR_URL = 'https://sponsor.moderato.tempo.xyz';
export const EXPLORER_URL = 'https://explore.testnet.tempo.xyz';

export const PATH_USD: Address = '0x20c0000000000000000000000000000000000000';
export const ALPHA_USD: Address = '0x20c0000000000000000000000000000000000001';
export const BETA_USD: Address = '0x20c0000000000000000000000000000000000002';
export const THETA_USD: Address = '0x20c0000000000000000000000000000000000003';
export const TOKEN_DECIMALS = 6;

/** Protocol guard that holds blocked transfers (TIP-1028). */
export const RECEIVE_POLICY_GUARD: Address = '0xB10C000000000000000000000000000000000000';

export const TRANSFER_WITH_MEMO_SIGNATURE = 'transferWithMemo(address,uint256,bytes32)' as const;
export const SECONDS_PER_DAY = 86_400;

/** getLogs on the public RPC is limited; stay well below it. */
export const MAX_LOG_RANGE = 50_000n;

export const explorerTxUrl = (hash: string) => `${EXPLORER_URL}/tx/${hash}`;
export const explorerAddressUrl = (address: string) => `${EXPLORER_URL}/address/${address}`;

/**
 * Timestamps in Portunus are ms since epoch. The chain uses unix seconds. Callers may pass either to the
 * live helpers: anything below 1e11 is read as seconds (year 5138 in ms, year 1973 in seconds).
 */
export const toUnixSeconds = (t: number): number => (t < 1e11 ? Math.floor(t) : Math.floor(t / 1000));
export const toMs = (t: number): number => (t < 1e11 ? Math.floor(t * 1000) : Math.floor(t));
