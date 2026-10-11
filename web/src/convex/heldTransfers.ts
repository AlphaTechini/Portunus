import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { action, internalMutation, internalQuery, query } from './_generated/server';
import { appError, productNow, requireLine } from './helpers';
import { chainReturnToSender } from './chain';
import { finishHeldReturnOp, heldReturnMemoPair, type HeldReturnPlan } from './opsSettlement';
import { explorerTxUrl, type TxResultJson } from '../lib/shared/tempo/adapter';
import type { SimLeg } from '../lib/shared/tempo/sim';

/** Line: wrong-token / unknown-sender / excess payments sitting in the guard. */
export const list = query({
	args: { sessionToken: v.string(), status: v.optional(v.union(v.literal('held'), v.literal('returned'), v.literal('matched'))) },
	handler: async (ctx, a) => {
		const { org } = await requireLine(ctx, a.sessionToken);
		const statuses = a.status ? [a.status] : (['held', 'returned', 'matched'] as const);
		const out = [];
		for (const st of statuses) {
			const rows = await ctx.db
				.query('heldTransfers')
				.withIndex('by_line_status', (q) => q.eq('lineOrgId', org._id).eq('status', st))
				.collect();
			for (const h of rows) {
				const c = h.containerId ? await ctx.db.get(h.containerId) : null;
				out.push({
					_id: h._id,
					receiptId: h.receiptId,
					token: h.token,
					tokenSymbol: h.tokenSymbol,
					amountUnits: h.amountUnits,
					originator: h.originator,
					recipient: h.recipient,
					memo: h.memo,
					blockedAt: h.blockedAt,
					reason: h.reason,
					status: h.status,
					returnedTxHash: h.returnedTxHash ?? null,
					returnedAt: h.returnedAt ?? null,
					containerNumber: c?.number ?? null,
					containerId: h.containerId ?? null,
					txHash: h.txHash ?? null,
					mode: h.mode ?? 'sim',
					explorerUrl: h.mode === 'live' && h.txHash ? explorerTxUrl(h.txHash) : null
				});
			}
		}
		return out.sort((x, y) => y.blockedAt - x.blockedAt);
	}
});

export const returnPlan = internalQuery({
	args: { sessionToken: v.string(), heldTransferId: v.id('heldTransfers') },
	handler: async (ctx, a): Promise<HeldReturnPlan> => {
		const { org } = await requireLine(ctx, a.sessionToken);
		const h = await ctx.db.get(a.heldTransferId);
		if (!h || h.lineOrgId !== org._id) throw appError('NOT_FOUND', 'Held transfer not found.');
		if (h.status !== 'held') throw appError('INVALID_STATE', 'This transfer was already returned.');
		const m = heldReturnMemoPair(h.receiptId);
		return {
			heldTransferId: h._id,
			receiptId: h.receiptId,
			receipt: h.receipt,
			token: h.token,
			amountUnits: h.amountUnits,
			originator: h.originator,
			lineOrgId: h.lineOrgId,
			memo: m.memo,
			memoHex: m.memoHex
		};
	}
});

export const finishReturn = internalMutation({
	args: { plan: v.any(), tx: v.any(), legs: v.any() },
	handler: async (ctx, a): Promise<null> => {
		await finishHeldReturnOp(ctx, a.plan as HeldReturnPlan, {
			tx: a.tx as TxResultJson,
			legs: a.legs as SimLeg[],
			now: await productNow(ctx)
		});
		return null;
	}
});

/** Line: send a held transfer back to its sender through the settlement contract. Never lost. */
export const returnToSender = action({
	args: { sessionToken: v.string(), heldTransferId: v.id('heldTransfers') },
	handler: async (ctx, a): Promise<{ heldTransferId: Id<'heldTransfers'>; txHash: string; finalityMs: number }> => {
		const plan = await ctx.runQuery(internal.heldTransfers.returnPlan, a);
		const res = await chainReturnToSender(ctx, {
			receiptId: plan.receiptId,
			receipt: plan.receipt,
			memo: plan.memoHex
		});
		if (!res.ok) throw appError('CHAIN_ERROR', res.error.message, { name: res.error.name });
		await ctx.runMutation(internal.heldTransfers.finishReturn, { plan, tx: res.tx, legs: res.legs });
		return { heldTransferId: a.heldTransferId, txHash: res.tx.txHash, finalityMs: res.tx.finalityMs };
	}
});
