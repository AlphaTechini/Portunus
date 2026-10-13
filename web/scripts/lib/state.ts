// State for the one-time live setup: testnet keys and deployment info in web/.state/tempo.json (gitignored).
// Pure helpers live here so they can be unit-tested without a network.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts';
import {
	ALPHA_USD,
	CHAIN_ID,
	DEFAULT_RPC_URL,
	DEFAULT_SPONSOR_URL,
	type Address,
	type Hex
} from '../../src/lib/shared/tempo/live/constants';

export const STATE_DIR = new URL('../../.state/', import.meta.url);
export const STATE_FILE = new URL('tempo.json', STATE_DIR);

export interface TempoState {
	/** Pays network fees for every server transaction (and browser ones if used as a relay). */
	sponsorKey?: Hex;
	/** Platform key: may call settle / settleMany / returnToSender. Also deploys the contract. */
	operatorKey?: Hex;
	/** The line's deposits account: virtual-address master with the receive policy. */
	depositsKey?: Hex;
	/** The line's charges address: a plain account with no receive policy. */
	chargesKey?: Hex;
	/** Dispute resolver. */
	resolverKey?: Hex;
	/** 32-byte AES-GCM key for stored access-key private keys. */
	accessKeyEncKey?: Hex;
	/** 16-bit random prefix so databases sharing the master never hand out the same virtual address. */
	vaEnvPrefix?: number;
	/** Virtual-address master registration. */
	salt?: Hex;
	masterId?: Hex;
	registeredTx?: Hex;
	/** Settlement contract. */
	settlement?: Address;
	settlementBlock?: string;
	settlementDeployTx?: Hex;
	/** keccak256 of the bytecode that was deployed, to detect a changed contract. */
	settlementCodeHash?: Hex;
	maxHoldSeconds?: number;
	policySetTx?: Hex;
	updatedAt?: string;
}

export const loadState = (): TempoState =>
	existsSync(STATE_FILE) ? (JSON.parse(readFileSync(STATE_FILE, 'utf8')) as TempoState) : {};

export function saveState(s: TempoState): void {
	mkdirSync(STATE_DIR, { recursive: true });
	s.updatedAt = new Date().toISOString();
	writeFileSync(STATE_FILE, JSON.stringify(s, null, 2) + '\n', { mode: 0o600 });
}

/** Fills in any missing key material. Existing values are never replaced. */
export function ensureKeys(s: TempoState): TempoState {
	s.sponsorKey ??= generatePrivateKey();
	s.operatorKey ??= generatePrivateKey();
	s.depositsKey ??= generatePrivateKey();
	s.chargesKey ??= generatePrivateKey();
	s.resolverKey ??= generatePrivateKey();
	s.accessKeyEncKey ??= `0x${randomBytes(32).toString('hex')}`;
	s.vaEnvPrefix ??= randomBytes(2).readUInt16BE(0);
	return s;
}

export function addresses(s: TempoState) {
	const addr = (k?: Hex) => (k ? privateKeyToAddress(k) : undefined);
	return {
		sponsor: addr(s.sponsorKey),
		operator: addr(s.operatorKey),
		deposits: addr(s.depositsKey),
		charges: addr(s.chargesKey),
		resolver: addr(s.resolverKey)
	};
}

/** The `npx convex env set ...` lines, one per variable. Values are quoted for the shell. */
export function convexEnvLines(s: TempoState, opts: { rpcUrl?: string } = {}): string[] {
	const rows: [string, string | number | undefined][] = [
		['TEMPO_RPC_URL', opts.rpcUrl ?? DEFAULT_RPC_URL],
		['TEMPO_SPONSOR_KEY', s.sponsorKey],
		['TEMPO_OPERATOR_KEY', s.operatorKey],
		['TEMPO_RESOLVER_KEY', s.resolverKey],
		['LINE_DEPOSITS_KEY', s.depositsKey],
		['ACCESS_KEY_ENC_KEY', s.accessKeyEncKey],
		['PORTUNUS_MASTER_ID', s.masterId],
		['PORTUNUS_SETTLEMENT', s.settlement],
		['PORTUNUS_CHARGES', addresses(s).charges],
		['PORTUNUS_DEPOSITS_ACCOUNT', addresses(s).deposits],
		['VA_ENV_PREFIX', s.vaEnvPrefix],
		// The indexer scans from here instead of genesis.
		['INDEXER_START_BLOCK', s.settlementBlock],
		// Last, so the app only flips to live once everything else is in place.
		['TEMPO_MODE', 'live']
	];
	return rows
		.filter(([, val]) => val !== undefined)
		.map(([name, val]) => `npx convex env set ${name} '${val}'`);
}

/** Non-secret values the app and the Convex seed need. */
export function publicConfig(s: TempoState, opts: { rpcUrl?: string } = {}) {
	const a = addresses(s);
	return {
		chainId: CHAIN_ID,
		rpcUrl: opts.rpcUrl ?? DEFAULT_RPC_URL,
		sponsorUrl: DEFAULT_SPONSOR_URL,
		token: ALPHA_USD,
		depositsAccount: a.deposits,
		chargesAddress: a.charges,
		operator: a.operator,
		resolver: a.resolver,
		settlementContract: s.settlement,
		masterId: s.masterId,
		vaEnvPrefix: s.vaEnvPrefix,
		settlementBlock: s.settlementBlock,
		maxHoldSeconds: s.maxHoldSeconds,
		env: {
			PUBLIC_TEMPO_RPC_URL: opts.rpcUrl ?? DEFAULT_RPC_URL,
			PUBLIC_TEMPO_SPONSOR_URL: DEFAULT_SPONSOR_URL
		}
	};
}
