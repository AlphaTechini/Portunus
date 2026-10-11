/**
 * Settlement orchestration: mutations record intent (`settling`), an action calls the chain,
 * a second mutation records the result (details 14.4). `executeSettlements` is the one entry
 * point used by postCharges, settleMany, triggerSettlement, disputes.open, the window-end job
 * and the sweep.
 */
import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { internalMutation, type ActionCtx } from './_generated/server';
import { productNow } from './helpers';
import { chainPull, chainRevokeKey, chainSettle, type ChainErr } from './chain';
import {
	beginSettlementOp,
	failSettlementOp,
	finishDepositFreeSettlementOp,
	finishHeldSettlementOp,
	type SettleSource,
	type SettlementPlan
} from './opsSettlement';
import { recordKeyRevokedOp } from './opsKeys';
import { runDetention } from './lifecycle';
import type { TxResultJson } from '../lib/shared/tempo/adapter';
import type { SimLeg } from '../lib/shared/tempo/sim';
import type { Hex } from '../lib/shared/domain/memo';

export interface SettleOutcome {
	containerId: Id<'containers'>;
	number?: string;
	status: 'settled' | 'disputed' | 'failed' | 'skipped' | 'posted';
	chargeUnits?: string;
	refundUnits?: string;
	disputedUnits?: string;
	txHash?: string;
	/** Hold on: the access key has to be revoked by the importer (live). */
	revokePending?: boolean;
	reason?: string;
	code?: string;
	cappedByDeposit?: boolean;
}

export const begin = internalMutation({
	args: {
		containerId: v.id('containers'),
		source: v.union(
			v.literal('line'),
			v.literal('window'),
			v.literal('importer'),
			v.literal('batch'),
			v.literal('dispute')
		),
		damageUnits: v.optional(v.string()),
		note: v.optional(v.string()),
		disputedUnits: v.optional(v.string()),
		dispute: v.optional(
			v.object({ openedBy: v.id('users'), reason: v.string(), evidence: v.optional(v.string()) })
		),
		actor: v.string()
	},
	handler: async (ctx, a): Promise<SettlementPlan> =>
		beginSettlementOp(ctx, { ...a, now: await productNow(ctx) })
});

export const finishHeld = internalMutation({
	args: { plan: v.any(), tx: v.any(), legs: v.any(), actor: v.string() },
	handler: async (ctx, a): Promise<null> => {
		await finishHeldSettlementOp(ctx, a.plan as SettlementPlan, {
			tx: a.tx as TxResultJson,
			legs: a.legs as SimLeg[],
			now: await productNow(ctx),
			actor: a.actor
		});
		return null;
	}
});

export const finishDepositFree = internalMutation({
	args: {
		plan: v.any(),
		damageTx: v.optional(v.any()),
		revokeTx: v.optional(v.any()),
		revokePending: v.boolean(),
		actor: v.string()
	},
	handler: async (ctx, a): Promise<null> => {
		const plan = a.plan as SettlementPlan;
		const now = await productNow(ctx);
		await finishDepositFreeSettlementOp(ctx, plan, {
			now,
			actor: a.actor,
			damageTx: a.damageTx as TxResultJson | undefined,
			revokeTx: (a.revokeTx as TxResultJson | undefined) ?? null,
			revokePending: a.revokePending
		});
		if (!a.revokePending && plan.depositFree) {
			await recordKeyRevokedOp(ctx, {
				keyId: plan.depositFree.keyId,
				tx: (a.revokeTx as TxResultJson | undefined) ?? null,
				now,
				by: 'settlement',
				actor: a.actor
			});
		}
		return null;
	}
});

export const fail = internalMutation({
	args: { plan: v.any(), error: v.any() },
	handler: async (ctx, a): Promise<null> => {
		await failSettlementOp(
			ctx,
			a.plan as SettlementPlan,
			a.error as ChainErr | string,
			await productNow(ctx)
		);
		return null;
	}
});

/** A settle that died between `begin` and `finish` leaves the container in `settling`: put it back. */
export const recoverStuck = internalMutation({
	args: { containerId: v.id('containers'), olderThanMs: v.number() },
	handler: async (ctx, a): Promise<boolean> => {
		const c = await ctx.db.get(a.containerId);
		const now = await productNow(ctx);
		if (!c || c.state !== 'settling') return false;
		if (now - c.stateChangedAt < a.olderThanMs) return false;
		await ctx.db.patch(c._id, {
			state: 'returned',
			stateChangedAt: now,
			pendingOnChain: {
				step: 'settle',
				since: c.pendingOnChain?.since ?? now,
				attempts: c.pendingOnChain?.attempts ?? 1,
				lastError: 'Settlement did not finish; retrying.'
			}
		});
		return true;
	}
});

export function errInfo(e: unknown): { code: string; message: string } {
	const data = (e as { data?: unknown }).data;
	if (data && typeof data === 'object' && 'code' in data) {
		const d = data as { code: string; message?: string };
		return { code: d.code, message: d.message ?? 'Request failed.' };
	}
	if (typeof data === 'string') return { code: 'ERROR', message: data };
	return { code: 'ERROR', message: e instanceof Error ? e.message : String(e) };
}

/**
 * Settle one or many returned containers. Held containers go in ONE settlement transaction
 * (settleMany); deposit-free containers finalise individually. Per-container failures are
 * reported in the outcomes, never thrown, so one bad container cannot block a batch.
 */
export async function executeSettlements(
	ctx: ActionCtx,
	a: {
		containerIds: Id<'containers'>[];
		source: SettleSource;
		actor: string;
		damageUnits?: string;
		note?: string;
		disputedUnits?: string;
		dispute?: { openedBy: Id<'users'>; reason: string; evidence?: string };
	}
): Promise<SettleOutcome[]> {
	const outcomes: SettleOutcome[] = [];
	const heldPlans: SettlementPlan[] = [];
	const freePlans: SettlementPlan[] = [];

	for (const containerId of a.containerIds) {
		try {
			// Deposit-free pulls must be caught up to the return date before the books close.
			await runDetention(ctx, containerId);
			const plan = await ctx.runMutation(internal.settlement.begin, {
				containerId,
				source: a.source,
				damageUnits: a.damageUnits,
				note: a.note,
				disputedUnits: a.disputedUnits,
				dispute: a.dispute,
				actor: a.actor
			});
			(plan.mode === 'held' ? heldPlans : freePlans).push(plan);
		} catch (e) {
			const { code, message } = errInfo(e);
			outcomes.push({ containerId, status: 'skipped', reason: message, code });
		}
	}

	if (heldPlans.length > 0) {
		const res = await chainSettle(ctx, {
			items: heldPlans.flatMap((p) =>
				p.items.map((i) => ({
					receiptId: i.receiptId,
					receipt: i.receipt,
					chargeUnits: i.chargeUnits,
					disputedUnits: i.disputedUnits,
					chargeMemo: i.chargeMemoHex,
					refundMemo: i.refundMemoHex
				}))
			)
		});
		if (!res.ok) {
			for (const p of heldPlans) {
				await ctx.runMutation(internal.settlement.fail, { plan: p, error: res.error });
				outcomes.push({
					containerId: p.containerId,
					number: p.number,
					status: 'failed',
					reason: res.error.message,
					code: res.error.name
				});
			}
		} else {
			for (const p of heldPlans) {
				await ctx.runMutation(internal.settlement.finishHeld, {
					plan: p,
					tx: res.tx,
					legs: res.legs,
					actor: a.actor
				});
				const disputed = BigInt(p.disputedUnits) > 0n;
				outcomes.push({
					containerId: p.containerId,
					number: p.number,
					status: disputed ? 'disputed' : 'settled',
					chargeUnits: p.chargeUnits,
					refundUnits: p.refundUnits,
					disputedUnits: p.disputedUnits,
					txHash: res.tx.txHash,
					cappedByDeposit: p.cappedByDeposit
				});
			}
		}
	}

	for (const p of freePlans) {
		const df = p.depositFree!;
		let damageTx: TxResultJson | undefined;
		if (df.damagePull) {
			const pull = await chainPull(ctx, {
				account: df.account,
				keyAddress: df.keyAddress,
				encPrivKey: df.encPrivKey,
				to: df.to,
				amountUnits: df.damagePull.amountUnits,
				memo: df.damagePull.memoHex as Hex
			});
			if (!pull.ok) {
				await ctx.runMutation(internal.settlement.fail, { plan: p, error: pull.error });
				outcomes.push({
					containerId: p.containerId,
					number: p.number,
					status: 'failed',
					reason:
						pull.error.name === 'SpendingLimitExceeded'
							? 'The access key daily cap has no room left today for the damage charge. Try again after the period resets.'
							: pull.error.message,
					code: pull.error.name
				});
				continue;
			}
			damageTx = pull.tx;
		}
		const revoke = await chainRevokeKey(ctx, { account: df.account, keyAddress: df.keyAddress });
		const revokePending = !revoke.ok;
		await ctx.runMutation(internal.settlement.finishDepositFree, {
			plan: p,
			damageTx,
			revokeTx: revoke.ok ? (revoke.tx ?? undefined) : undefined,
			revokePending,
			actor: a.actor
		});
		outcomes.push({
			containerId: p.containerId,
			number: p.number,
			status: 'settled',
			chargeUnits: p.chargeUnits,
			refundUnits: '0',
			revokePending,
			txHash: damageTx?.txHash
		});
	}
	return outcomes;
}

/** Turn a skipped/failed outcome into a user-facing error (single-container actions). */
export function throwIfNotDone(o: SettleOutcome): SettleOutcome {
	if (o.status === 'skipped' || o.status === 'failed') {
		throw new ConvexError({
			code: o.code && o.code !== 'ERROR' ? o.code : 'INVALID_STATE',
			message: o.reason ?? 'Settlement did not complete.'
		});
	}
	return o;
}
