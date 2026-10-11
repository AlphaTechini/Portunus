/**
 * Simulated Tempo chain (brief section 11 "Sim behaviour spec"), as pure logic over a
 * `SimStore`. `src/convex/sim.ts` backs the store with the `sim_*` tables; tests can
 * back it with a Map.
 *
 * Rules mirrored from Tempo:
 *  - Any transfer to a deposits account (or one of its virtual addresses) is routed to the
 *    receive-policy guard as a receipt; it never credits a balance.
 *  - Batches are all-or-nothing: every call is validated before anything is applied.
 *  - Access keys: recipient scope, token, expiry, revoked forever, periodic limit with
 *    rollover anchored at authorization time. Over-limit pulls are REFUSED and record no tx.
 *  - Settlement: each receipt settles at most once, charge + disputed <= amount, payouts only
 *    to the charges address or the original payer.
 */
import { keccak256, stringToHex } from 'viem';
import { ReceivePolicyReceipt } from 'viem/tempo';
import { isVirtualAddress, parseVirtualAddress } from '../domain/virtualAddress';
import { RECEIVE_POLICY_GUARD } from '../domain/constants';
import { decodeMemo } from '../domain/memo';
import {
	ChainError,
	SpendingLimitExceededError,
	type Hex,
	type HeldReceiptJson
} from './adapter';

export interface SimMeta {
	seq: number;
	block: number;
	blockedNonce: number;
	clockOffsetMs: number;
	envPrefix: number;
}

export interface SimMaster {
	masterId: string;
	/** The line deposits account (policy owner). */
	account: string;
	/** Recovery authority = settlement contract. */
	settlement: string;
	/** Charges address: plain account with no receive policy. */
	charges: string;
	resolver: string;
	/** The token settlement accepts (AlphaUSD). Other tokens can only be returned. */
	token: string;
}

export interface SimKey {
	account: string;
	keyId: string;
	token: string;
	max: string;
	remaining: string;
	/** Seconds. */
	period: number;
	/** ms. */
	periodEnd: number;
	/** ms. */
	expiry: number;
	recipients: string[];
	selector: 'transferWithMemo';
	revoked: boolean;
	authorizedAt: number;
}

export type ReceiptStatus = 'held' | 'settled' | 'disputed' | 'returned';

export interface SimReceipt {
	id: string;
	receipt: string;
	token: string;
	amount: string;
	originator: string;
	recipient: string;
	/** Deposits account the receipt belongs to. */
	master: string;
	blockedAt: number;
	blockedNonce: number;
	memo: string;
	blockedReason: 'tokenFilter' | 'receivePolicy';
	txHash: string;
	logIndex: number;
	status: ReceiptStatus;
	/** Disputed amount in escrow. */
	escrow: string;
	charged: string;
	refunded: string;
	settleTxHash?: string;
}

export type SimEventArgs = Record<string, string | number | boolean | null>;

export interface SimEvent {
	txHash: string;
	logIndex: number;
	name: string;
	args: SimEventArgs;
	blockNumber: number;
	timestamp: number;
}

export interface SimStore {
	getMeta(): Promise<SimMeta>;
	setMeta(meta: SimMeta): Promise<void>;
	getBalance(address: string, token: string): Promise<bigint>;
	setBalance(address: string, token: string, amount: bigint): Promise<void>;
	/** Master registered for this deposits account or virtual-address master id. */
	findMasterForAddress(address: string): Promise<SimMaster | null>;
	getKey(account: string, keyId: string): Promise<SimKey | null>;
	putKey(key: SimKey): Promise<void>;
	getReceipt(id: string): Promise<SimReceipt | null>;
	putReceipt(receipt: SimReceipt): Promise<void>;
	addEvent(event: SimEvent): Promise<void>;
}

export interface SimTx {
	seq: number;
	txHash: Hex;
	blockNumber: number;
	timestamp: number;
	/** 450 + (seq % 100) ms: what the action awaits before reporting finality. */
	finalityMs: number;
}

export interface SimLeg {
	receiptId: string;
	kind: 'charge' | 'refund' | 'dispute_release' | 'held_return';
	to: string;
	amountUnits: string;
	memo: Hex;
	logIndex: number;
}

const lc = (s: string): string => s.toLowerCase();

export function stableJson(value: unknown): string {
	return JSON.stringify(value, (_k, v) => {
		if (typeof v === 'bigint') return v.toString();
		if (v && typeof v === 'object' && !Array.isArray(v)) {
			return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)));
		}
		return v;
	});
}

export function simTxHash(seq: number, method: string, args: unknown): Hex {
	return keccak256(stringToHex(`portunus-sim:${seq}:${method}:${stableJson(args)}`));
}

export function simFinalityMs(seq: number): number {
	return 450 + (seq % 100);
}

export function receiptIdOf(receipt: string): Hex {
	return keccak256(receipt as Hex);
}

export function toHeldJson(r: SimReceipt): HeldReceiptJson {
	return {
		id: r.id as Hex,
		receipt: r.receipt as Hex,
		token: r.token as Hex,
		amount: r.amount,
		originator: r.originator as Hex,
		recipient: r.recipient as Hex,
		blockedAt: r.blockedAt,
		memo: r.memo as Hex,
		blockedReason: r.blockedReason,
		txHash: r.txHash as Hex,
		logIndex: r.logIndex
	};
}

export class SimChain {
	constructor(
		private readonly store: SimStore,
		/** Product "now" in ms (Date.now() + clock offset). */
		private readonly now: () => number
	) {}

	// ---- transactions --------------------------------------------------

	private async beginTx(method: string, args: unknown, at: number | undefined): Promise<{ tx: SimTx; log: TxLog }> {
		const meta = await this.store.getMeta();
		const seq = meta.seq + 1;
		const block = meta.block + 1;
		await this.store.setMeta({ ...meta, seq, block });
		const tx: SimTx = {
			seq,
			txHash: simTxHash(seq, method, args),
			blockNumber: block,
			timestamp: at ?? this.now(),
			finalityMs: simFinalityMs(seq)
		};
		return { tx, log: new TxLog(this.store, tx) };
	}

	private async nextNonce(): Promise<number> {
		const meta = await this.store.getMeta();
		const blockedNonce = meta.blockedNonce + 1;
		await this.store.setMeta({ ...meta, blockedNonce });
		return blockedNonce;
	}

	private async credit(address: string, token: string, amount: bigint): Promise<void> {
		const bal = await this.store.getBalance(lc(address), lc(token));
		await this.store.setBalance(lc(address), lc(token), bal + amount);
	}

	private async debit(address: string, token: string, amount: bigint): Promise<void> {
		const bal = await this.store.getBalance(lc(address), lc(token));
		if (bal < amount) {
			throw new ChainError(
				'InsufficientBalance',
				`Insufficient balance: ${bal} available, ${amount} required`,
				{ available: bal.toString(), required: amount.toString(), token: lc(token) }
			);
		}
		await this.store.setBalance(lc(address), lc(token), bal - amount);
	}

	// ---- faucet ---------------------------------------------------------

	/** Credit test tokens. Does not produce a transaction receipt for the app. */
	async fund(address: string, token: string, amount: bigint): Promise<void> {
		await this.credit(address, token, amount);
	}

	async balanceOf(address: string, token: string): Promise<bigint> {
		return this.store.getBalance(lc(address), lc(token));
	}

	// ---- transfers ------------------------------------------------------

	/**
	 * All-or-nothing batch of TIP-20 transfers from one payer. Transfers to a deposits
	 * account (or any of its virtual addresses) are held by the guard as receipts.
	 */
	async transferBatch(a: {
		from: string;
		token: string;
		calls: { to: string; amount: bigint; memo?: Hex }[];
		at?: number;
		method?: string;
	}): Promise<{ tx: SimTx; held: HeldReceiptJson[] }> {
		const token = lc(a.token);
		const from = lc(a.from);
		if (a.calls.length === 0) throw new ChainError('InvalidAmount', 'Empty batch');
		let required = 0n;
		for (const c of a.calls) {
			if (c.amount <= 0n) throw new ChainError('InvalidAmount', 'Transfer amount must be greater than zero');
			required += c.amount;
		}
		const available = await this.store.getBalance(from, token);
		if (available < required) {
			throw new ChainError(
				'InsufficientBalance',
				`Insufficient balance: ${available} available, ${required} required`,
				{ available: available.toString(), required: required.toString(), token }
			);
		}
		// Resolve every destination before applying anything.
		const masters = await Promise.all(a.calls.map((c) => this.store.findMasterForAddress(lc(c.to))));

		const { tx, log } = await this.beginTx(a.method ?? 'transferBatch', {
			from,
			token,
			calls: a.calls.map((c) => ({ to: lc(c.to), amount: c.amount, memo: c.memo ?? null }))
		}, a.at);
		const held: HeldReceiptJson[] = [];
		for (let i = 0; i < a.calls.length; i++) {
			const c = a.calls[i];
			const to = lc(c.to);
			const master = masters[i];
			await this.debit(from, token, c.amount);
			if (!master) {
				await log.emit('Transfer', { token, from, to, amount: c.amount.toString() });
				if (c.memo) await log.emit('TransferWithMemo', { token, from, to, amount: c.amount.toString(), memo: c.memo });
				await this.credit(to, token, c.amount);
				continue;
			}
			// Receive policy reject-all: the funds sit in the guard under one receipt.
			const blockedNonce = await this.nextNonce();
			const memo = (c.memo ?? '0x'.padEnd(66, '0')) as Hex;
			const receipt = ReceivePolicyReceipt.encode({
				version: 1,
				token: token as Hex,
				recoveryAuthority: master.settlement as Hex,
				originator: from as Hex,
				recipient: to as Hex,
				blockedAt: BigInt(Math.floor(tx.timestamp / 1000)),
				blockedNonce: BigInt(blockedNonce),
				blockedReason: 'receivePolicy',
				kind: 'transfer',
				memo
			});
			const id = receiptIdOf(receipt);
			await log.emit('Transfer', { token, from, to: lc(RECEIVE_POLICY_GUARD), amount: c.amount.toString() });
			if (c.memo) await log.emit('TransferWithMemo', { token, from, to, amount: c.amount.toString(), memo: c.memo });
			const logIndex = await log.emit('TransferBlocked', {
				token,
				receiver: master.account,
				blockedNonce,
				amount: c.amount.toString(),
				receiptVersion: 1,
				receipt
			});
			const rec: SimReceipt = {
				id,
				receipt,
				token,
				amount: c.amount.toString(),
				originator: from,
				recipient: to,
				master: master.account,
				blockedAt: tx.timestamp,
				blockedNonce,
				memo,
				blockedReason: 'receivePolicy',
				txHash: tx.txHash,
				logIndex,
				status: 'held',
				escrow: '0',
				charged: '0',
				refunded: '0'
			};
			await this.store.putReceipt(rec);
			held.push(toHeldJson(rec));
		}
		return { tx, held };
	}

	// ---- access keys ----------------------------------------------------

	/** Importer root key authorizes a key with a periodic limit, recipient scope and expiry. */
	async authorizeKey(a: {
		account: string;
		keyId: string;
		token: string;
		limit: bigint;
		periodSec: number;
		recipients: string[];
		expiry: number; // ms
		at?: number;
	}): Promise<{ tx: SimTx; key: SimKey }> {
		const at = a.at ?? this.now();
		const existing = await this.store.getKey(lc(a.account), lc(a.keyId));
		if (existing) {
			throw new ChainError(
				existing.revoked ? 'KeyAlreadyRevoked' : 'KeyAlreadyExists',
				existing.revoked ? 'This key was revoked and can never be authorized again' : 'Key already authorized'
			);
		}
		if (a.expiry <= at) throw new ChainError('KeyExpired', 'Expiry must be in the future');
		if (a.limit <= 0n) throw new ChainError('InvalidAmount', 'Limit must be greater than zero');
		const { tx, log } = await this.beginTx('authorizeKey', {
			account: lc(a.account),
			keyId: lc(a.keyId),
			limit: a.limit,
			period: a.periodSec,
			recipients: a.recipients.map(lc),
			expiry: a.expiry
		}, a.at);
		const key: SimKey = {
			account: lc(a.account),
			keyId: lc(a.keyId),
			token: lc(a.token),
			max: a.limit.toString(),
			remaining: a.limit.toString(),
			period: a.periodSec,
			periodEnd: at + a.periodSec * 1000,
			expiry: a.expiry,
			recipients: a.recipients.map(lc),
			selector: 'transferWithMemo',
			revoked: false,
			authorizedAt: at
		};
		await this.store.putKey(key);
		await log.emit('KeyAuthorized', {
			account: key.account,
			publicKey: key.keyId,
			signatureType: 0,
			expiry: Math.floor(a.expiry / 1000)
		});
		return { tx, key };
	}

	private static rolled(key: SimKey, at: number): { remaining: bigint; periodEnd: number } {
		let remaining = BigInt(key.remaining);
		let periodEnd = key.periodEnd;
		if (at >= periodEnd) {
			const periodMs = key.period * 1000;
			const n = Math.floor((at - periodEnd) / periodMs) + 1;
			periodEnd += n * periodMs;
			remaining = BigInt(key.max);
		}
		return { remaining, periodEnd };
	}

	/** Read: remaining limit as of `at` (period rollover applied) and key metadata. */
	async keyState(a: { account: string; keyId: string; at?: number }): Promise<{
		remainingUnits: string;
		periodEnd: number;
		expiry: number;
		isRevoked: boolean;
		exists: boolean;
	}> {
		const key = await this.store.getKey(lc(a.account), lc(a.keyId));
		if (!key) return { remainingUnits: '0', periodEnd: 0, expiry: 0, isRevoked: false, exists: false };
		const r = SimChain.rolled(key, a.at ?? this.now());
		return {
			remainingUnits: r.remaining.toString(),
			periodEnd: r.periodEnd,
			expiry: key.expiry,
			isRevoked: key.revoked,
			exists: true
		};
	}

	/**
	 * The line pulls with the access key (sponsored). Refuses with `SpendingLimitExceededError`
	 * (recording NO transaction) when the amount exceeds what is left in the current period.
	 */
	async pull(a: {
		account: string;
		keyId: string;
		token: string;
		to: string;
		amount: bigint;
		memo: Hex;
		at?: number;
	}): Promise<{ tx: SimTx; remainingUnits: string; periodEnd: number }> {
		const at = a.at ?? this.now();
		const account = lc(a.account);
		const key = await this.store.getKey(account, lc(a.keyId));
		if (!key) throw new ChainError('KeyNotFound', 'Access key not found for this account');
		if (key.revoked) throw new ChainError('KeyAlreadyRevoked', 'The importer revoked this access key');
		if (at >= key.expiry) throw new ChainError('KeyExpired', 'The access key has expired');
		if (lc(a.token) !== key.token || !key.recipients.includes(lc(a.to))) {
			throw new ChainError('CallNotAllowed', 'The access key may only pay the line charges address');
		}
		if (a.amount <= 0n) throw new ChainError('InvalidAmount', 'Amount must be greater than zero');
		const r = SimChain.rolled(key, at);
		if (a.amount > r.remaining) throw new SpendingLimitExceededError(r.remaining, r.periodEnd);
		const balance = await this.store.getBalance(account, key.token);
		if (balance < a.amount) {
			throw new ChainError('InsufficientBalance', `Insufficient balance: ${balance} available, ${a.amount} required`, {
				available: balance.toString(),
				required: a.amount.toString(),
				token: key.token
			});
		}
		const { tx, log } = await this.beginTx('pull', {
			account,
			keyId: key.keyId,
			to: lc(a.to),
			amount: a.amount,
			memo: a.memo
		}, a.at);
		const remaining = r.remaining - a.amount;
		await this.store.putKey({ ...key, remaining: remaining.toString(), periodEnd: r.periodEnd });
		await this.debit(account, key.token, a.amount);
		await this.credit(a.to, key.token, a.amount);
		await log.emit('AccessKeySpend', {
			account,
			publicKey: key.keyId,
			token: key.token,
			amount: a.amount.toString(),
			remainingLimit: remaining.toString()
		});
		await log.emit('Transfer', { token: key.token, from: account, to: lc(a.to), amount: a.amount.toString() });
		await log.emit('TransferWithMemo', {
			token: key.token,
			from: account,
			to: lc(a.to),
			amount: a.amount.toString(),
			memo: a.memo
		});
		return { tx, remainingUnits: remaining.toString(), periodEnd: r.periodEnd };
	}

	/** Only the importer root key can revoke. Revoked forever. */
	async revokeKey(a: { account: string; keyId: string; at?: number }): Promise<{ tx: SimTx }> {
		const key = await this.store.getKey(lc(a.account), lc(a.keyId));
		if (!key) throw new ChainError('KeyNotFound', 'Access key not found for this account');
		if (key.revoked) throw new ChainError('KeyAlreadyRevoked', 'Key already revoked');
		const { tx, log } = await this.beginTx('revokeKey', { account: key.account, keyId: key.keyId }, a.at);
		await this.store.putKey({ ...key, revoked: true });
		await log.emit('KeyRevoked', { account: key.account, publicKey: key.keyId });
		return { tx };
	}

	// ---- settlement contract -------------------------------------------

	async readGuardBalance(receiptId: string): Promise<bigint> {
		const r = await this.store.getReceipt(receiptId);
		return r && r.status === 'held' ? BigInt(r.amount) : 0n;
	}

	/**
	 * PortunusSettlement.settle/settleMany. Each receipt settles at most once; the charge goes to
	 * the line's charges address, the disputed part stays in escrow, the rest returns to the payer.
	 */
	async settle(a: {
		items: { receiptId: string; charge: bigint; disputed: bigint; chargeMemo: Hex; refundMemo: Hex }[];
		at?: number;
	}): Promise<{
		tx: SimTx;
		legs: SimLeg[];
		results: { receiptId: string; chargedUnits: string; refundedUnits: string; escrowUnits: string }[];
	}> {
		if (a.items.length === 0) throw new ChainError('InvalidReceipt', 'Nothing to settle');
		const seen = new Set<string>();
		const loaded: { item: (typeof a.items)[number]; rec: SimReceipt; master: SimMaster }[] = [];
		for (const item of a.items) {
			if (seen.has(item.receiptId)) throw new ChainError('ReceiptAlreadySettled', 'Receipt appears twice in this batch');
			seen.add(item.receiptId);
			const rec = await this.store.getReceipt(item.receiptId);
			if (!rec) throw new ChainError('InvalidReceipt', 'Unknown receipt');
			if (rec.status !== 'held') throw new ChainError('ReceiptAlreadySettled', 'This receipt was already settled');
			const master = await this.store.findMasterForAddress(rec.recipient);
			if (!master || lc(master.settlement) !== lc(decodeReceipt(rec).recoveryAuthority)) {
				throw new ChainError('InvalidReceipt', 'The settlement contract is not the recovery authority for this receipt');
			}
			if (lc(rec.token) !== lc(master.token)) {
				throw new ChainError('WrongToken', 'Only the settlement token can be settled; return other tokens to the sender');
			}
			if (item.charge < 0n || item.disputed < 0n || item.charge + item.disputed > BigInt(rec.amount)) {
				throw new ChainError('ChargeExceedsAmount', 'charge + disputed exceeds the held amount');
			}
			loaded.push({ item, rec, master });
		}
		const { tx, log } = await this.beginTx('settle', a.items.map((i) => ({ ...i, charge: i.charge, disputed: i.disputed })), a.at);
		const legs: SimLeg[] = [];
		const results: { receiptId: string; chargedUnits: string; refundedUnits: string; escrowUnits: string }[] = [];
		for (const { item, rec, master } of loaded) {
			const amount = BigInt(rec.amount);
			const refund = amount - item.charge - item.disputed;
			await log.emit('ReceiptClaimed', {
				token: rec.token,
				receiver: master.account,
				blockedNonce: rec.blockedNonce,
				originator: rec.originator,
				recipient: rec.recipient,
				recoveryAuthority: master.settlement,
				caller: master.settlement,
				to: master.settlement,
				amount: rec.amount
			});
			if (item.charge > 0n) {
				await this.credit(master.charges, rec.token, item.charge);
				await log.emit('Transfer', { token: rec.token, from: master.settlement, to: master.charges, amount: item.charge.toString() });
				const logIndex = await log.emit('TransferWithMemo', {
					token: rec.token,
					from: master.settlement,
					to: master.charges,
					amount: item.charge.toString(),
					memo: item.chargeMemo
				});
				legs.push({ receiptId: rec.id, kind: 'charge', to: master.charges, amountUnits: item.charge.toString(), memo: item.chargeMemo, logIndex });
			}
			if (refund > 0n) {
				await this.credit(rec.originator, rec.token, refund);
				await log.emit('Transfer', { token: rec.token, from: master.settlement, to: rec.originator, amount: refund.toString() });
				const logIndex = await log.emit('TransferWithMemo', {
					token: rec.token,
					from: master.settlement,
					to: rec.originator,
					amount: refund.toString(),
					memo: item.refundMemo
				});
				legs.push({ receiptId: rec.id, kind: 'refund', to: rec.originator, amountUnits: refund.toString(), memo: item.refundMemo, logIndex });
			}
			await log.emit('Settled', {
				id: rec.id,
				originator: rec.originator,
				depositAddress: rec.recipient,
				charged: item.charge.toString(),
				refunded: refund.toString(),
				disputedHeld: item.disputed.toString()
			});
			await this.store.putReceipt({
				...rec,
				status: item.disputed > 0n ? 'disputed' : 'settled',
				escrow: item.disputed.toString(),
				charged: item.charge.toString(),
				refunded: refund.toString(),
				settleTxHash: tx.txHash
			});
			results.push({
				receiptId: rec.id,
				chargedUnits: item.charge.toString(),
				refundedUnits: refund.toString(),
				escrowUnits: item.disputed.toString()
			});
		}
		return { tx, legs, results };
	}

	/** Resolver only, once: toLine to the charges address, the rest of the escrow to the payer. */
	async resolveDispute(a: {
		receiptId: string;
		toLine: bigint;
		memo: Hex;
		at?: number;
	}): Promise<{ tx: SimTx; legs: SimLeg[]; toLineUnits: string; toPayerUnits: string }> {
		const rec = await this.store.getReceipt(a.receiptId);
		if (!rec) throw new ChainError('InvalidReceipt', 'Unknown receipt');
		if (rec.status !== 'disputed') throw new ChainError('NotDisputed', 'This receipt has no open dispute');
		const escrow = BigInt(rec.escrow);
		if (a.toLine < 0n || a.toLine > escrow) throw new ChainError('ChargeExceedsAmount', 'toLine exceeds the escrow');
		const master = await this.store.findMasterForAddress(rec.recipient);
		if (!master) throw new ChainError('InvalidReceipt', 'No deposits account for this receipt');
		const { tx, log } = await this.beginTx('resolveDispute', { id: rec.id, toLine: a.toLine, memo: a.memo }, a.at);
		const toPayer = escrow - a.toLine;
		const legs: SimLeg[] = [];
		if (a.toLine > 0n) {
			await this.credit(master.charges, rec.token, a.toLine);
			await log.emit('Transfer', { token: rec.token, from: master.settlement, to: master.charges, amount: a.toLine.toString() });
			const logIndex = await log.emit('TransferWithMemo', { token: rec.token, from: master.settlement, to: master.charges, amount: a.toLine.toString(), memo: a.memo });
			legs.push({ receiptId: rec.id, kind: 'dispute_release', to: master.charges, amountUnits: a.toLine.toString(), memo: a.memo, logIndex });
		}
		if (toPayer > 0n) {
			await this.credit(rec.originator, rec.token, toPayer);
			await log.emit('Transfer', { token: rec.token, from: master.settlement, to: rec.originator, amount: toPayer.toString() });
			const logIndex = await log.emit('TransferWithMemo', { token: rec.token, from: master.settlement, to: rec.originator, amount: toPayer.toString(), memo: a.memo });
			legs.push({ receiptId: rec.id, kind: 'dispute_release', to: rec.originator, amountUnits: toPayer.toString(), memo: a.memo, logIndex });
		}
		await log.emit('DisputeResolved', { id: rec.id, toLine: a.toLine.toString(), toPayer: toPayer.toString() });
		await this.store.putReceipt({
			...rec,
			status: 'settled',
			escrow: '0',
			charged: (BigInt(rec.charged) + a.toLine).toString(),
			refunded: (BigInt(rec.refunded) + toPayer).toString()
		});
		return { tx, legs, toLineUnits: a.toLine.toString(), toPayerUnits: toPayer.toString() };
	}

	/** Wrong token / unknown sender: the full receipt goes straight back to the originator. */
	async returnToSender(a: { receiptId: string; memo: Hex; at?: number }): Promise<{ tx: SimTx; legs: SimLeg[] }> {
		const rec = await this.store.getReceipt(a.receiptId);
		if (!rec) throw new ChainError('InvalidReceipt', 'Unknown receipt');
		if (rec.status !== 'held') throw new ChainError('ReceiptAlreadySettled', 'This receipt was already settled or returned');
		const master = await this.store.findMasterForAddress(rec.recipient);
		const { tx, log } = await this.beginTx('returnToSender', { id: rec.id }, a.at);
		await this.credit(rec.originator, rec.token, BigInt(rec.amount));
		await log.emit('ReceiptClaimed', {
			token: rec.token,
			receiver: master?.account ?? rec.master,
			blockedNonce: rec.blockedNonce,
			originator: rec.originator,
			recipient: rec.recipient,
			recoveryAuthority: master?.settlement ?? null,
			caller: master?.settlement ?? null,
			to: rec.originator,
			amount: rec.amount
		});
		await log.emit('Transfer', { token: rec.token, from: master?.settlement ?? rec.master, to: rec.originator, amount: rec.amount });
		const logIndex = await log.emit('TransferWithMemo', { token: rec.token, from: master?.settlement ?? rec.master, to: rec.originator, amount: rec.amount, memo: a.memo });
		await log.emit('Returned', { id: rec.id, originator: rec.originator, token: rec.token, amount: rec.amount });
		await this.store.putReceipt({ ...rec, status: 'returned', refunded: rec.amount, settleTxHash: tx.txHash });
		return { tx, legs: [{ receiptId: rec.id, kind: 'held_return', to: rec.originator, amountUnits: rec.amount, memo: a.memo, logIndex }] };
	}
}

class TxLog {
	private i = 0;
	constructor(
		private readonly store: SimStore,
		private readonly tx: SimTx
	) {}
	async emit(name: string, args: SimEventArgs): Promise<number> {
		const logIndex = this.i++;
		await this.store.addEvent({
			txHash: this.tx.txHash,
			logIndex,
			name,
			args,
			blockNumber: this.tx.blockNumber,
			timestamp: this.tx.timestamp
		});
		return logIndex;
	}
}

function decodeReceipt(rec: SimReceipt): { recoveryAuthority: string; originator: string; recipient: string } {
	const d = ReceivePolicyReceipt.decode(rec.receipt as Hex);
	return { recoveryAuthority: d.recoveryAuthority, originator: d.originator, recipient: d.recipient };
}

/** True when `address` is a virtual address (so a master id lookup applies). */
export function looksVirtual(address: string): boolean {
	return isVirtualAddress(address);
}

export { parseVirtualAddress };

/** Memo helper for event display. */
export function memoText(memoHex: string): string {
	return decodeMemo(memoHex);
}
