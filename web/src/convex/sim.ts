/**
 * Simulated Tempo chain: internal mutations over the `sim_*` tables (brief section 11).
 * Every function returns `{ ok: true, ... } | { ok: false, error }`. A failed call changes
 * nothing (validation runs before any write), so a refused pull records no transaction.
 */
import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import { ChainError, SpendingLimitExceededError, type HeldReceiptJson, type TxResultJson } from '../lib/shared/tempo/adapter';
import type { SimLeg } from '../lib/shared/tempo/sim';
import { ALPHA_USD } from '../lib/shared/domain/constants';
import { getSimChain, makeSimStore, registerSimMaster, simFaucet, simTxJson, ensureSimMeta } from './simStore';
import type { Hex } from '../lib/shared/tempo/adapter';

export type SimError = {
	name: string;
	message: string;
	remainingUnits?: string;
	periodEnd?: number;
	available?: string;
	required?: string;
	[k: string]: string | number | boolean | undefined;
};
export type SimFail = { ok: false; error: SimError };

export function toSimError(e: unknown): SimFail {
	if (e instanceof SpendingLimitExceededError) {
		return {
			ok: false,
			error: {
				name: 'SpendingLimitExceeded',
				message: e.message,
				remainingUnits: e.remaining.toString(),
				periodEnd: e.periodEnd
			}
		};
	}
	if (e instanceof ChainError) {
		return { ok: false, error: { name: e.chain, message: e.message, ...e.data } };
	}
	throw e;
}

const callV = v.object({ to: v.string(), amountUnits: v.string(), memo: v.optional(v.string()) });

export const transferBatch = internalMutation({
	args: {
		from: v.string(),
		token: v.optional(v.string()),
		calls: v.array(callV),
		at: v.optional(v.number())
	},
	handler: async (
		ctx,
		a
	): Promise<{ ok: true; tx: TxResultJson; held: HeldReceiptJson[] } | SimFail> => {
		const chain = await getSimChain(ctx);
		try {
			const r = await chain.transferBatch({
				from: a.from,
				token: a.token ?? ALPHA_USD,
				calls: a.calls.map((c) => ({ to: c.to, amount: BigInt(c.amountUnits), memo: c.memo as Hex | undefined })),
				at: a.at
			});
			return { ok: true, tx: simTxJson(r.tx), held: r.held };
		} catch (e) {
			return toSimError(e);
		}
	}
});

export const authorizeKey = internalMutation({
	args: {
		account: v.string(),
		keyId: v.string(),
		token: v.optional(v.string()),
		limitUnits: v.string(),
		periodSec: v.number(),
		recipients: v.array(v.string()),
		expiry: v.number(),
		at: v.optional(v.number())
	},
	handler: async (ctx, a): Promise<{ ok: true; tx: TxResultJson } | SimFail> => {
		const chain = await getSimChain(ctx);
		try {
			const r = await chain.authorizeKey({
				account: a.account,
				keyId: a.keyId,
				token: a.token ?? ALPHA_USD,
				limit: BigInt(a.limitUnits),
				periodSec: a.periodSec,
				recipients: a.recipients,
				expiry: a.expiry,
				at: a.at
			});
			return { ok: true, tx: simTxJson(r.tx) };
		} catch (e) {
			return toSimError(e);
		}
	}
});

export const pull = internalMutation({
	args: {
		account: v.string(),
		keyId: v.string(),
		token: v.optional(v.string()),
		to: v.string(),
		amountUnits: v.string(),
		memo: v.string(),
		at: v.optional(v.number())
	},
	handler: async (
		ctx,
		a
	): Promise<{ ok: true; tx: TxResultJson; remainingUnits: string; periodEnd: number } | SimFail> => {
		const chain = await getSimChain(ctx);
		try {
			const r = await chain.pull({
				account: a.account,
				keyId: a.keyId,
				token: a.token ?? ALPHA_USD,
				to: a.to,
				amount: BigInt(a.amountUnits),
				memo: a.memo as Hex,
				at: a.at
			});
			return { ok: true, tx: simTxJson(r.tx), remainingUnits: r.remainingUnits, periodEnd: r.periodEnd };
		} catch (e) {
			return toSimError(e);
		}
	}
});

export const revokeKey = internalMutation({
	args: { account: v.string(), keyId: v.string(), at: v.optional(v.number()) },
	handler: async (ctx, a): Promise<{ ok: true; tx: TxResultJson } | SimFail> => {
		const chain = await getSimChain(ctx);
		try {
			const r = await chain.revokeKey(a);
			return { ok: true, tx: simTxJson(r.tx) };
		} catch (e) {
			return toSimError(e);
		}
	}
});

export const keyState = internalQuery({
	args: { account: v.string(), keyId: v.string(), at: v.optional(v.number()) },
	handler: async (ctx, a) => {
		const store = makeSimStore(ctx.db as never);
		const key = await store.getKey(a.account, a.keyId);
		if (!key) return { exists: false, remainingUnits: '0', periodEnd: 0, expiry: 0, isRevoked: false };
		const meta = await ctx.db.query('sim_meta').first();
		const at = a.at ?? Date.now() + (meta?.clockOffsetMs ?? 0);
		let remaining = BigInt(key.remaining);
		let periodEnd = key.periodEnd;
		if (at >= periodEnd) {
			const pm = key.period * 1000;
			periodEnd += (Math.floor((at - periodEnd) / pm) + 1) * pm;
			remaining = BigInt(key.max);
		}
		return {
			exists: true,
			remainingUnits: remaining.toString(),
			periodEnd,
			expiry: key.expiry,
			isRevoked: key.revoked
		};
	}
});

const settleItem = v.object({
	receiptId: v.string(),
	chargeUnits: v.string(),
	disputedUnits: v.string(),
	chargeMemo: v.string(),
	refundMemo: v.string()
});

export type SimSettleOk = {
	ok: true;
	tx: TxResultJson;
	legs: SimLeg[];
	/** True when every receipt had already been settled: the original transaction is returned. */
	alreadySettled?: boolean;
};

export const settle = internalMutation({
	args: { items: v.array(settleItem), at: v.optional(v.number()) },
	handler: async (ctx, a): Promise<SimSettleOk | SimFail> => {
		const chain = await getSimChain(ctx);
		const store = makeSimStore(ctx.db);
		// Idempotency: if every receipt is already settled by one transaction, report that one.
		const recs = await Promise.all(a.items.map((i) => store.getReceipt(i.receiptId)));
		if (recs.length > 0 && recs.every((r) => r && r.status !== 'held' && r.settleTxHash)) {
			const txHash = recs[0]!.settleTxHash!;
			const first = await ctx.db
				.query('sim_events')
				.withIndex('by_tx', (q) => q.eq('txHash', txHash))
				.first();
			return {
				ok: true,
				alreadySettled: true,
				tx: {
					mode: 'sim',
					txHash: txHash as Hex,
					blockNumber: String(first?.blockNumber ?? 0),
					timestamp: first?.timestamp ?? Date.now(),
					explorerUrl: null,
					finalityMs: 0
				},
				legs: []
			};
		}
		try {
			const r = await chain.settle({
				items: a.items.map((i) => ({
					receiptId: i.receiptId,
					charge: BigInt(i.chargeUnits),
					disputed: BigInt(i.disputedUnits),
					chargeMemo: i.chargeMemo as Hex,
					refundMemo: i.refundMemo as Hex
				})),
				at: a.at
			});
			return { ok: true, tx: simTxJson(r.tx), legs: r.legs };
		} catch (e) {
			return toSimError(e);
		}
	}
});

export const resolveDispute = internalMutation({
	args: { receiptId: v.string(), toLineUnits: v.string(), memo: v.string(), at: v.optional(v.number()) },
	handler: async (ctx, a): Promise<{ ok: true; tx: TxResultJson; legs: SimLeg[] } | SimFail> => {
		const chain = await getSimChain(ctx);
		try {
			const r = await chain.resolveDispute({
				receiptId: a.receiptId,
				toLine: BigInt(a.toLineUnits),
				memo: a.memo as Hex,
				at: a.at
			});
			return { ok: true, tx: simTxJson(r.tx), legs: r.legs };
		} catch (e) {
			return toSimError(e);
		}
	}
});

export const returnToSender = internalMutation({
	args: { receiptId: v.string(), memo: v.string(), at: v.optional(v.number()) },
	handler: async (ctx, a): Promise<{ ok: true; tx: TxResultJson; legs: SimLeg[] } | SimFail> => {
		const chain = await getSimChain(ctx);
		try {
			const r = await chain.returnToSender({ receiptId: a.receiptId, memo: a.memo as Hex, at: a.at });
			return { ok: true, tx: simTxJson(r.tx), legs: r.legs };
		} catch (e) {
			return toSimError(e);
		}
	}
});

export const fund = internalMutation({
	args: { address: v.string(), amountUnits: v.optional(v.string()) },
	handler: async (ctx, a): Promise<null> => {
		await simFaucet(ctx, a.address, a.amountUnits ? BigInt(a.amountUnits) : undefined);
		return null;
	}
});

export const balance = internalQuery({
	args: { address: v.string(), token: v.optional(v.string()) },
	handler: async (ctx, a): Promise<string> => {
		const store = makeSimStore(ctx.db as never);
		return (await store.getBalance(a.address, a.token ?? ALPHA_USD)).toString();
	}
});

export const registerMaster = internalMutation({
	args: {
		masterId: v.string(),
		account: v.string(),
		settlement: v.string(),
		charges: v.string(),
		resolver: v.string(),
		token: v.optional(v.string())
	},
	handler: async (ctx, a): Promise<null> => {
		await ensureSimMeta(ctx);
		await registerSimMaster(ctx, { ...a, token: a.token ?? ALPHA_USD });
		return null;
	}
});

/** Sim clock. Exposed to demo controls only. */
export const bumpClock = internalMutation({
	args: { ms: v.number() },
	handler: async (ctx, a): Promise<number> => {
		const meta = await ensureSimMeta(ctx);
		await ctx.db.patch(meta._id, { clockOffsetMs: meta.clockOffsetMs + a.ms });
		return meta.clockOffsetMs + a.ms;
	}
});

export const setClock = internalMutation({
	args: { offsetMs: v.number() },
	handler: async (ctx, a): Promise<number> => {
		const meta = await ensureSimMeta(ctx);
		await ctx.db.patch(meta._id, { clockOffsetMs: a.offsetMs });
		return a.offsetMs;
	}
});

export const receipt = internalQuery({
	args: { receiptId: v.string() },
	handler: async (ctx, a) => {
		const store = makeSimStore(ctx.db as never);
		return store.getReceipt(a.receiptId);
	}
});
