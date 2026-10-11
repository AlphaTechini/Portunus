/**
 * Backstop sweep (details 14.3, 14.6). Finds every container whose scheduled step was missed or
 * failed and re-runs it. Safe to run any number of times: each detention day is processed exactly
 * once (`detentionDays`), settlement happens at most once, and chain steps are idempotent.
 * Runs daily from the cron and immediately after the demo clock moves.
 */
import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { internalAction, internalMutation, internalQuery } from './_generated/server';
import { chainMode, productNow } from './helpers';
import { chainListHeldReceipts } from './chain';
import { ingestReceipts } from './opsDeposits';
import { runDetention, withJob } from './lifecycle';
import { executeSettlements } from './settlement';
import { detentionDaysAt } from '../lib/shared/domain/rules';
import { DAY_MS } from '../lib/shared/domain/constants';
import type { HeldReceiptJson } from '../lib/shared/tempo/adapter';

export interface SweepWork {
	now: number;
	detention: Id<'containers'>[];
	settleDue: Id<'containers'>[];
	stuck: Id<'containers'>[];
	keyWarn: Id<'containers'>[];
	unscheduled: Id<'containers'>[];
}

export const findWork = internalQuery({
	args: {},
	handler: async (ctx): Promise<SweepWork> => {
		const now = await productNow(ctx);
		const work: SweepWork = { now, detention: [], settleDue: [], stuck: [], keyWarn: [], unscheduled: [] };
		const states = ['released', 'in_free_time', 'in_detention', 'returned', 'settling'] as const;
		for (const state of states) {
			const rows = await ctx.db
				.query('containers')
				.withIndex('by_state', (q) => q.eq('state', state))
				.collect();
			for (const c of rows) {
				const F = c.freeTimeEndsAt;
				if (state === 'settling') {
					work.stuck.push(c._id);
					continue;
				}
				if (F !== undefined) {
					const due = detentionDaysAt({ freeTimeEndsAt: F, maxDetentionDays: c.maxDetentionDays, returnedAt: c.returnedAt }, now);
					const needs =
						state === 'released' || state === 'in_free_time'
							? now >= F
							: state === 'in_detention'
								? due > c.detentionDays
								: c.mode === 'depositFree' && due > c.detentionDays;
					if (needs) work.detention.push(c._id);
				}
				if (state === 'returned' && c.settlementWindowEndsAt !== undefined && now >= c.settlementWindowEndsAt) {
					work.settleDue.push(c._id);
				}
				if (!c.scheduledJobId) work.unscheduled.push(c._id);
				if (c.mode === 'depositFree' && c.accessKeyId) {
					const key = await ctx.db.get(c.accessKeyId);
					if (key && key.status === 'active' && !key.expiryWarned && key.expiry - now <= DAY_MS) work.keyWarn.push(c._id);
				}
			}
		}
		return work;
	}
});

export interface SweepSummary {
	now: number;
	detentionRuns: number;
	detentionDaysProcessed: number;
	settled: number;
	recovered: number;
	warned: number;
	rescheduled: number;
	indexed: number;
	errors: string[];
}

export const run = internalAction({
	args: {},
	handler: async (ctx): Promise<SweepSummary> => {
		const summary: SweepSummary = {
			now: 0,
			detentionRuns: 0,
			detentionDaysProcessed: 0,
			settled: 0,
			recovered: 0,
			warned: 0,
			rescheduled: 0,
			indexed: 0,
			errors: []
		};
		const job = await ctx.runMutation(internal.lifecycle.jobStart, { kind: 'sweep' });
		try {
			let work = await ctx.runQuery(internal.sweep.findWork, {});
			summary.now = work.now;

			// 1. Settlements that died half way go back to `returned` so they are retried below.
			for (const id of work.stuck) {
				if (await ctx.runMutation(internal.settlement.recoverStuck, { containerId: id, olderThanMs: 2 * 60_000 })) summary.recovered++;
			}

			// 2. Detention: catch up every missed day, in order, once each.
			for (const id of work.detention) {
				const r = await withJob(ctx, 'sweep:detention', id, () => runDetention(ctx, id));
				summary.detentionRuns++;
				if (r.ok) summary.detentionDaysProcessed += r.value.processed;
				else summary.errors.push(r.error);
			}

			// 3. Returned containers whose window ended settle automatically (one batch).
			work = await ctx.runQuery(internal.sweep.findWork, {});
			if (work.settleDue.length > 0) {
				const r = await withJob(ctx, 'sweep:settle', undefined, () =>
					executeSettlements(ctx, { containerIds: work.settleDue, source: 'window', actor: 'Portunus scheduler' })
				);
				if (r.ok) summary.settled += r.value.filter((o) => o.status === 'settled' || o.status === 'disputed').length;
				else summary.errors.push(r.error);
			}

			// 4. Key expiry warnings and missing schedules.
			for (const id of work.keyWarn) {
				await ctx.runMutation(internal.lifecycle.keyExpiryWarning, { containerId: id });
				summary.warned++;
			}
			for (const id of work.unscheduled) {
				await ctx.runMutation(internal.lifecycle.scheduleNext, { containerId: id });
				summary.rescheduled++;
			}

			// 5. Live: index guard receipts that arrived outside the app (stray transfers).
			summary.indexed = await indexLive(ctx);
			await ctx.runMutation(internal.lifecycle.jobFinish, { id: job, ok: summary.errors.length === 0, error: summary.errors[0] });
		} catch (e) {
			const error = e instanceof Error ? e.message : String(e);
			summary.errors.push(error);
			await ctx.runMutation(internal.lifecycle.jobFinish, { id: job, ok: false, error });
		}
		return summary;
	}
});

export const linesToIndex = internalQuery({
	args: {},
	handler: async (ctx) => {
		const lines = await ctx.db
			.query('organizations')
			.withIndex('by_kind', (q) => q.eq('kind', 'line'))
			.collect();
		return lines
			.filter((l) => l.depositsAccount)
			.map((l) => ({ orgId: l._id, depositsAccount: l.depositsAccount!, fromBlock: l.lastIndexedBlock ?? '0' }));
	}
});

export const ingestIndexed = internalMutation({
	args: { orgId: v.id('organizations'), receipts: v.any(), toBlock: v.string() },
	handler: async (ctx, a): Promise<number> => {
		const r = await ingestReceipts(ctx, a.receipts as HeldReceiptJson[], {
			mode: 'live',
			finalityMs: 0,
			now: await productNow(ctx)
		});
		await ctx.db.patch(a.orgId, { lastIndexedBlock: a.toBlock });
		return r.deposits.length + r.heldTransfers.length;
	}
});

async function indexLive(ctx: import('./_generated/server').ActionCtx): Promise<number> {
	if (chainMode() !== 'live') return 0;
	let n = 0;
	for (const line of await ctx.runQuery(internal.sweep.linesToIndex, {})) {
		const res = await chainListHeldReceipts(ctx, { depositsAccount: line.depositsAccount, fromBlock: line.fromBlock });
		if (!res.ok) continue;
		n += await ctx.runMutation(internal.sweep.ingestIndexed, { orgId: line.orgId, receipts: res.receipts, toBlock: res.toBlock });
	}
	return n;
}

/** Cron entry for the live indexer (no-op in sim). */
export const indexReceipts = internalAction({
	args: {},
	handler: async (ctx): Promise<number> => indexLive(ctx)
});
