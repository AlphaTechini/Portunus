/**
 * Plain (non-Convex-function) helpers that back the shared SimChain with the `sim_*` tables.
 * Used by `sim.ts` (internal mutations) and directly by `seed.ts`, which runs inside one mutation.
 */
import type { Doc } from './_generated/dataModel';
import type { DatabaseWriter, MutationCtx } from './_generated/server';
import { clockOffset, lc } from './helpers';
import {
	SimChain,
	type SimEvent,
	type SimKey,
	type SimMaster,
	type SimMeta,
	type SimReceipt,
	type SimStore,
	type SimTx
} from '../lib/shared/tempo/sim';
import { DEFAULT_ENV_PREFIX, simMasterIdForIndex } from '../lib/shared/domain/virtualAddress';
import { ALPHA_USD, BETA_USD, PATH_USD } from '../lib/shared/domain/constants';
import type { TxResultJson } from '../lib/shared/tempo/adapter';

const FAUCET_TOKENS = [PATH_USD, ALPHA_USD, BETA_USD];

export async function ensureSimMeta(ctx: { db: DatabaseWriter }): Promise<Doc<'sim_meta'>> {
	const existing = await ctx.db.query('sim_meta').first();
	if (existing) return existing;
	const id = await ctx.db.insert('sim_meta', {
		seq: 0,
		block: 1_000_000,
		blockedNonce: 0,
		clockOffsetMs: 0,
		envPrefix: DEFAULT_ENV_PREFIX
	});
	return (await ctx.db.get(id))!;
}

export function makeSimStore(db: DatabaseWriter): SimStore {
	return {
		async getMeta(): Promise<SimMeta> {
			const m = await db.query('sim_meta').first();
			if (!m) {
				return {
					seq: 0,
					block: 1_000_000,
					blockedNonce: 0,
					clockOffsetMs: 0,
					envPrefix: DEFAULT_ENV_PREFIX
				};
			}
			return {
				seq: m.seq,
				block: m.block,
				blockedNonce: m.blockedNonce,
				clockOffsetMs: m.clockOffsetMs,
				envPrefix: m.envPrefix
			};
		},
		async setMeta(meta) {
			const m = await db.query('sim_meta').first();
			if (m) await db.patch(m._id, meta);
			else await db.insert('sim_meta', meta);
		},
		async getBalance(address, token) {
			const row = await db
				.query('sim_balances')
				.withIndex('by_address_token', (q) => q.eq('address', lc(address)).eq('token', lc(token)))
				.unique();
			return row ? BigInt(row.amount) : 0n;
		},
		async setBalance(address, token, amount) {
			const row = await db
				.query('sim_balances')
				.withIndex('by_address_token', (q) => q.eq('address', lc(address)).eq('token', lc(token)))
				.unique();
			if (row) await db.patch(row._id, { amount: amount.toString() });
			else
				await db.insert('sim_balances', {
					address: lc(address),
					token: lc(token),
					amount: amount.toString()
				});
		},
		async findMasterForAddress(address) {
			const a = lc(address);
			const byAccount = await db
				.query('sim_masters')
				.withIndex('by_account', (q) => q.eq('account', a))
				.unique();
			if (byAccount) return toMaster(byAccount);
			// virtual address layout: 4 bytes master id | fdfd.. | 6 bytes tag
			if (/^0x[0-9a-f]{8}fdfdfdfdfdfdfdfdfdfd[0-9a-f]{12}$/.test(a)) {
				const masterId = a.slice(0, 10);
				const byId = await db
					.query('sim_masters')
					.withIndex('by_master_id', (q) => q.eq('masterId', masterId))
					.unique();
				if (byId) return toMaster(byId);
			}
			return null;
		},
		async getKey(account, keyId) {
			const row = await db
				.query('sim_keys')
				.withIndex('by_account_key', (q) => q.eq('account', lc(account)).eq('keyId', lc(keyId)))
				.unique();
			return row ? toKey(row) : null;
		},
		async putKey(key: SimKey) {
			const row = await db
				.query('sim_keys')
				.withIndex('by_account_key', (q) => q.eq('account', key.account).eq('keyId', key.keyId))
				.unique();
			if (row) await db.patch(row._id, key);
			else await db.insert('sim_keys', key);
		},
		async getReceipt(id) {
			const row = await db
				.query('sim_receipts')
				.withIndex('by_receipt_id', (q) => q.eq('id', id))
				.unique();
			return row ? toReceipt(row) : null;
		},
		async putReceipt(receipt: SimReceipt) {
			const row = await db
				.query('sim_receipts')
				.withIndex('by_receipt_id', (q) => q.eq('id', receipt.id))
				.unique();
			if (row) await db.patch(row._id, receipt);
			else await db.insert('sim_receipts', receipt);
		},
		async addEvent(event: SimEvent) {
			await db.insert('sim_events', event);
		}
	};
}

function toMaster(m: Doc<'sim_masters'>): SimMaster {
	return {
		masterId: m.masterId,
		account: m.account,
		settlement: m.settlement,
		charges: m.charges,
		resolver: m.resolver,
		token: m.token
	};
}

function toKey(k: Doc<'sim_keys'>): SimKey {
	return {
		account: k.account,
		keyId: k.keyId,
		token: k.token,
		max: k.max,
		remaining: k.remaining,
		period: k.period,
		periodEnd: k.periodEnd,
		expiry: k.expiry,
		recipients: k.recipients,
		selector: k.selector,
		revoked: k.revoked,
		authorizedAt: k.authorizedAt
	};
}

function toReceipt(r: Doc<'sim_receipts'>): SimReceipt {
	return {
		id: r.id,
		receipt: r.receipt,
		token: r.token,
		amount: r.amount,
		originator: r.originator,
		recipient: r.recipient,
		master: r.master,
		blockedAt: r.blockedAt,
		blockedNonce: r.blockedNonce,
		memo: r.memo,
		blockedReason: r.blockedReason,
		txHash: r.txHash,
		logIndex: r.logIndex,
		status: r.status,
		escrow: r.escrow,
		charged: r.charged,
		refunded: r.refunded,
		settleTxHash: r.settleTxHash
	};
}

/** A SimChain bound to this mutation's db and the product clock. */
export async function getSimChain(ctx: { db: DatabaseWriter }): Promise<SimChain> {
	await ensureSimMeta(ctx);
	const offset = await clockOffset(ctx);
	return new SimChain(makeSimStore(ctx.db), () => Date.now() + offset);
}

export function simTxJson(tx: SimTx): TxResultJson {
	return {
		mode: 'sim',
		txHash: tx.txHash,
		blockNumber: String(tx.blockNumber),
		timestamp: tx.timestamp,
		explorerUrl: null,
		finalityMs: tx.finalityMs
	};
}

/** Register (idempotently) the deposits account of a sim line with the guard. */
export async function registerSimMaster(ctx: { db: DatabaseWriter }, m: SimMaster): Promise<void> {
	const existing = await ctx.db
		.query('sim_masters')
		.withIndex('by_account', (q) => q.eq('account', lc(m.account)))
		.unique();
	const row = {
		masterId: lc(m.masterId),
		account: lc(m.account),
		settlement: lc(m.settlement),
		charges: lc(m.charges),
		resolver: lc(m.resolver),
		token: lc(m.token)
	};
	if (existing) await ctx.db.patch(existing._id, row);
	else await ctx.db.insert('sim_masters', row);
}

/** Faucet: 1,000,000 of each test token (brief section 11). */
export async function simFaucet(
	ctx: { db: DatabaseWriter },
	address: string,
	amount = 1_000_000_000_000n
): Promise<void> {
	const chain = await getSimChain(ctx);
	for (const t of FAUCET_TOKENS) await chain.fund(address, t, amount);
}

export async function nextSimLineIndex(ctx: MutationCtx): Promise<number> {
	const lines = await ctx.db
		.query('organizations')
		.withIndex('by_kind', (q) => q.eq('kind', 'line'))
		.collect();
	let max = -1;
	for (const l of lines) if (l.simIndex !== undefined && l.simIndex > max) max = l.simIndex;
	return max + 1;
}

export { simMasterIdForIndex };
