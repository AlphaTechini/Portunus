/**
 * TempoAdapter: the one interface the product talks to (brief section 11).
 * Pure types, so Convex actions and the browser can both import it.
 * `sim` is implemented by `./sim.ts` + `src/convex/sim.ts`; `live` by
 * `src/convex/tempoNode.ts` (server) and `src/lib/tempo/*` (browser, passkeys).
 */
import { EXPLORER_URL } from '../domain/constants';

export type Hex = `0x${string}`;
export type Address = Hex;
export type Mode = 'live' | 'sim';

export interface TxResult {
	mode: Mode;
	txHash: Hex;
	blockNumber: bigint;
	timestamp: number; // ms
	explorerUrl: string | null;
}

export interface HeldReceipt {
	id: Hex; // keccak256(receipt)
	receipt: Hex;
	token: Address;
	amount: bigint;
	originator: Address;
	recipient: Address; // the virtual address that was paid
	blockedAt: number; // ms
	memo: Hex;
	blockedReason: 'tokenFilter' | 'receivePolicy';
	txHash: Hex;
	logIndex: number;
}

export class SpendingLimitExceededError extends Error {
	readonly code = 'SpendingLimitExceeded' as const;
	constructor(
		public remaining: bigint,
		public periodEnd: number
	) {
		super('Spending limit exceeded (refused by the chain)');
		this.name = 'SpendingLimitExceededError';
	}
}

/** Errors raised by the chain (real or simulated), mirroring the Tempo precompile error names. */
export type ChainErrorName =
	| 'InsufficientBalance'
	| 'KeyAlreadyRevoked'
	| 'KeyAlreadyExists'
	| 'KeyNotFound'
	| 'KeyExpired'
	| 'CallNotAllowed'
	| 'InvalidReceipt'
	| 'ReceiptAlreadySettled'
	| 'ChargeExceedsAmount'
	| 'WrongToken'
	| 'InvalidAmount'
	| 'NotDisputed';

export class ChainError extends Error {
	constructor(
		public readonly chain: ChainErrorName,
		message: string,
		public readonly data: Record<string, string | number | boolean> = {}
	) {
		super(message);
		this.name = 'ChainError';
	}
}

export interface Signer {
	address: Address;
	kind: 'passkey' | 'server';
}

export interface TempoAdapter {
	readonly mode: Mode;
	health(): Promise<{ ok: boolean; chainId?: number; blockNumber?: bigint; error?: string }>;
	fundFromFaucet(address: Address): Promise<TxResult[]>;
	createVirtualAddress(a: { masterId: Hex; envPrefix: number; containerSeq: number }): Address;
	payDepositsBatch(a: {
		payer: Signer;
		token: Address;
		items: { to: Address; amount: bigint; memo: Hex }[];
	}): Promise<TxResult & { held: HeldReceipt[] }>;
	confirmDeposits(a: { txHash: Hex }): Promise<HeldReceipt[]>;
	createAccessKey(): Promise<{ keyAddress: Address; encPrivKey: string }>;
	authorizeAccessKey(a: {
		owner: Signer;
		keyAddress: Address;
		token: Address;
		dailyLimit: bigint;
		periodSec: number;
		recipient: Address;
		expiry: number;
	}): Promise<TxResult>;
	getAccessKeyState(a: {
		account: Address;
		keyAddress: Address;
		token: Address;
	}): Promise<{ remaining: bigint; periodEnd: number; expiry: number; isRevoked: boolean }>;
	pullDetention(a: {
		account: Address;
		encPrivKey: string;
		token: Address;
		to: Address;
		amount: bigint;
		memo: Hex;
	}): Promise<TxResult>; // throws SpendingLimitExceededError
	revokeKey(a: { owner: Signer; keyAddress: Address }): Promise<TxResult>;
	settle(a: {
		items: { receipt: Hex; charge: bigint; disputed: bigint; chargeMemo: Hex; refundMemo: Hex }[];
	}): Promise<TxResult>;
	returnHeldTransfer(a: { receipt: Hex }): Promise<TxResult>;
	readGuardBalance(a: { receipt: Hex }): Promise<bigint>;
	listHeldReceipts(a: {
		depositsAccount: Address;
		fromBlock: bigint;
	}): Promise<{ receipts: HeldReceipt[]; toBlock: bigint }>;
	getBalance(a: { account: Address; token: Address }): Promise<bigint>;
}

// ---------------------------------------------------------------------------
// JSON-safe variants (ARCHITECTURE section 6): bigint becomes a decimal string.
// ---------------------------------------------------------------------------

export interface TxResultJson {
	mode: Mode;
	txHash: Hex;
	blockNumber: string;
	timestamp: number;
	explorerUrl: string | null;
	finalityMs: number;
}

export interface HeldReceiptJson {
	id: Hex;
	receipt: Hex;
	token: Address;
	amount: string;
	originator: Address;
	recipient: Address;
	blockedAt: number;
	memo: Hex;
	blockedReason: 'tokenFilter' | 'receivePolicy';
	txHash: Hex;
	logIndex: number;
}

export interface AccessKeyStateJson {
	remainingUnits: string;
	periodEnd: number;
	expiry: number;
	isRevoked: boolean;
}

/** What a pull returns when the chain refuses it. Never a transaction. */
export interface SpendingLimitRefusalJson {
	error: 'SpendingLimitExceeded';
	remainingUnits: string;
	periodEnd: number;
}

export function explorerTxUrl(hash: string): string {
	return `${EXPLORER_URL}/tx/${hash}`;
}

export function txToJson(tx: TxResult, finalityMs: number): TxResultJson {
	return {
		mode: tx.mode,
		txHash: tx.txHash,
		blockNumber: tx.blockNumber.toString(),
		timestamp: tx.timestamp,
		explorerUrl: tx.explorerUrl,
		finalityMs
	};
}

export function txFromJson(j: TxResultJson): TxResult {
	return {
		mode: j.mode,
		txHash: j.txHash,
		blockNumber: BigInt(j.blockNumber),
		timestamp: j.timestamp,
		explorerUrl: j.explorerUrl
	};
}

export function heldToJson(r: HeldReceipt): HeldReceiptJson {
	return { ...r, amount: r.amount.toString() };
}

export function heldFromJson(j: HeldReceiptJson): HeldReceipt {
	return { ...j, amount: BigInt(j.amount) };
}

export function isSpendingLimitRefusal(x: unknown): x is SpendingLimitRefusalJson {
	return typeof x === 'object' && x !== null && (x as { error?: unknown }).error === 'SpendingLimitExceeded';
}

/** Normalise a chain timestamp that may be unix seconds or milliseconds to milliseconds. */
export function toMs(t: number): number {
	return t < 100_000_000_000 ? t * 1000 : t;
}
