/**
 * Scheduled lifecycle work (details 14.3). Convex scheduled actions run at most once and are
 * not retried, so every step here is idempotent and the daily sweep re-runs anything missed.
 */
import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { internalAction, internalMutation, type ActionCtx } from './_generated/server';
import { logEvent, notify, productNow } from './helpers';
import { chainPull } from './chain';
import {
	detentionStepOp,
	pullResultOp,
	scheduleNextJob,
	type DetentionStep,
	type PullOutcome
} from './opsLifecycle';
import { executeSettlements } from './settlement';
import { formatUsd, u } from '../lib/shared/domain/money';
import type { Hex } from '../lib/shared/domain/memo';

const fmtDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

// --- job audit ---------------------------------------------------------------------------

export const jobStart = internalMutation({
	args: { kind: v.string(), containerId: v.optional(v.id('containers')) },
	handler: async (ctx, a): Promise<Id<'jobRuns'>> => {
		const now = await productNow(ctx);
		return ctx.db.insert('jobRuns', { kind: a.kind, containerId: a.containerId, scheduledFor: now, ranAt: now });
	}
});

export const jobFinish = internalMutation({
	args: { id: v.id('jobRuns'), ok: v.boolean(), error: v.optional(v.string()) },
	handler: async (ctx, a): Promise<null> => {
		await ctx.db.patch(a.id, { ok: a.ok, error: a.error });
		return null;
	}
});

/** Run `fn` and record a jobRuns row. Errors are captured, not thrown (scheduled actions never retry). */
export async function withJob<T>(
	ctx: ActionCtx,
	kind: string,
	containerId: Id<'containers'> | undefined,
	fn: () => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
	const id = await ctx.runMutation(internal.lifecycle.jobStart, { kind, containerId });
	try {
		const value = await fn();
		await ctx.runMutation(internal.lifecycle.jobFinish, { id, ok: true });
		return { ok: true, value };
	} catch (e) {
		const error = e instanceof Error ? e.message : String(e);
		await ctx.runMutation(internal.lifecycle.jobFinish, { id, ok: false, error });
		return { ok: false, error };
	}
}

// --- detention ---------------------------------------------------------------------------

export const detentionStep = internalMutation({
	args: { containerId: v.id('containers') },
	handler: async (ctx, a): Promise<DetentionStep> => detentionStepOp(ctx, a.containerId, await productNow(ctx))
});

export const pullResult = internalMutation({
	args: {
		containerId: v.id('containers'),
		day: v.number(),
		dueAt: v.number(),
		amountUnits: v.string(),
		memo: v.string(),
		memoHex: v.string(),
		account: v.string(),
		to: v.string(),
		result: v.any()
	},
	handler: async (ctx, a): Promise<PullOutcome> =>
		pullResultOp(ctx, { ...a, now: await productNow(ctx), result: a.result })
});

export const scheduleNext = internalMutation({
	args: { containerId: v.id('containers') },
	handler: async (ctx, a): Promise<null> => {
		await scheduleNextJob(ctx, a.containerId, await productNow(ctx));
		return null;
	}
});

/**
 * Process every due detention day for one container: held accrues, deposit-free pulls one day
 * at a time through the access key at the day's due time. Safe to call repeatedly.
 */
export async function runDetention(ctx: ActionCtx, containerId: Id<'containers'>): Promise<{ processed: number }> {
	let processed = 0;
	for (let i = 0; i < 80; i++) {
		const step = await ctx.runMutation(internal.lifecycle.detentionStep, { containerId });
		if (step.kind === 'done') break;
		const res = await chainPull(ctx, {
			account: step.account,
			keyAddress: step.keyAddress,
			encPrivKey: step.encPrivKey,
			to: step.to,
			amountUnits: step.amountUnits,
			memo: step.memoHex as Hex,
			at: step.dueAt
		});
		const outcome = await ctx.runMutation(internal.lifecycle.pullResult, {
			containerId,
			day: step.day,
			dueAt: step.dueAt,
			amountUnits: step.amountUnits,
			memo: step.memo,
			memoHex: step.memoHex,
			account: step.account,
			to: step.to,
			result: res
		});
		if (outcome.advanced) processed++;
		if (outcome.retry) break;
	}
	await ctx.runMutation(internal.lifecycle.scheduleNext, { containerId });
	return { processed };
}

export const onFreeTimeEnd = internalAction({
	args: { containerId: v.id('containers') },
	handler: async (ctx, a): Promise<null> => {
		await withJob(ctx, 'onFreeTimeEnd', a.containerId, () => runDetention(ctx, a.containerId));
		return null;
	}
});

export const dailyDetention = internalAction({
	args: { containerId: v.id('containers') },
	handler: async (ctx, a): Promise<null> => {
		await withJob(ctx, 'dailyDetention', a.containerId, () => runDetention(ctx, a.containerId));
		return null;
	}
});

export const onWindowEnd = internalAction({
	args: { containerId: v.id('containers') },
	handler: async (ctx, a): Promise<null> => {
		await withJob(ctx, 'onWindowEnd', a.containerId, async () => {
			await runDetention(ctx, a.containerId);
			return executeSettlements(ctx, { containerIds: [a.containerId], source: 'window', actor: 'Portunus scheduler' });
		});
		return null;
	}
});

export const keyExpiryWarning = internalMutation({
	args: { containerId: v.id('containers') },
	handler: async (ctx, a): Promise<null> => {
		const now = await productNow(ctx);
		const key = await ctx.db
			.query('accessKeys')
			.withIndex('by_container', (q) => q.eq('containerId', a.containerId))
			.first();
		const c = await ctx.db.get(a.containerId);
		if (!key || !c || key.status !== 'active' || key.expiryWarned) return null;
		if (c.state === 'settled' || c.state === 'settling') return null;
		await ctx.db.patch(key._id, { expiryWarned: true });
		const body = `The access key for ${c.number} expires ${fmtDate(key.expiry)}. After that no detention can be pulled. Daily cap ${formatUsd(u(key.dailyLimitUnits))}.`;
		await notify(ctx, { orgId: c.lineOrgId, kind: 'key_expiry', title: `Access key expires soon: ${c.number}`, body, containerId: c._id, at: now });
		await notify(ctx, { orgId: c.importerOrgId, kind: 'key_expiry', title: `Access key expires soon: ${c.number}`, body, containerId: c._id, at: now });
		await logEvent(ctx, c._id, 'key_expiry_warning', 'Access key expires within a day', now, fmtDate(key.expiry));
		return null;
	}
});
