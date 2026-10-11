/**
 * Demo controls. Sim chain only (except trySecondPull, which also works live). They move the
 * product clock, inject strangers' transfers and show the chain refusing a second same-day pull.
 */
import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { action, internalMutation, internalQuery } from './_generated/server';
import { appError, chainMode, demoEnabled, productNow, requireSession, requireLine, simAddress, logEvent, notify } from './helpers';
import { chainPull, chainPayBatch } from './chain';
import { ingestReceipts } from './opsDeposits';
import { runDetention } from './lifecycle';
import type { SweepSummary } from './sweep';
import { DAY_MS, ALPHA_USD, BETA_USD } from '../lib/shared/domain/constants';
import { encodeMemo, pullMemo, type Hex } from '../lib/shared/domain/memo';
import { toUnits, u, formatUsd } from '../lib/shared/domain/money';
import type { HeldReceiptJson } from '../lib/shared/tempo/adapter';

function requireDemoSim(): void {
	if (!demoEnabled()) throw appError('DEMO_DISABLED', 'Demo controls are turned off.');
	if (chainMode() !== 'sim') throw appError('NOT_SUPPORTED', 'The clock and stranger transfers only exist on the simulated chain.');
}

export const guard = internalQuery({
	args: { sessionToken: v.string() },
	handler: async (ctx, a): Promise<{ now: number }> => {
		await requireSession(ctx, a.sessionToken);
		return { now: await productNow(ctx) };
	}
});

export interface AdvanceResult {
	offsetMs: number;
	simNow: number;
	sweep: SweepSummary;
}

async function advance(ctx: Parameters<typeof runDetention>[0], ms: number): Promise<AdvanceResult> {
	const offsetMs = await ctx.runMutation(internal.sim.bumpClock, { ms });
	const sweep = await ctx.runAction(internal.sweep.run, {});
	return { offsetMs, simNow: Date.now() + offsetMs, sweep };
}

/** Move the product clock forward and run the sweep so every due step executes (free time end, daily detention, window end). */
export const advanceClock = action({
	args: { sessionToken: v.string(), ms: v.number() },
	handler: async (ctx, a): Promise<AdvanceResult> => {
		requireDemoSim();
		await ctx.runQuery(internal.demo.guard, { sessionToken: a.sessionToken });
		if (!Number.isFinite(a.ms) || a.ms <= 0 || a.ms > 400 * DAY_MS) {
			throw appError('INVALID', 'Move the clock forward by up to 400 days.');
		}
		return advance(ctx, Math.round(a.ms));
	}
});

export const freeTimeEndOf = internalQuery({
	args: { sessionToken: v.string(), containerId: v.id('containers') },
	handler: async (ctx, a): Promise<{ freeTimeEndsAt: number; now: number }> => {
		await requireSession(ctx, a.sessionToken);
		const c = await ctx.db.get(a.containerId);
		if (!c || c.freeTimeEndsAt === undefined) throw appError('INVALID_STATE', 'That container has no free time running.');
		if (c.state !== 'in_free_time' && c.state !== 'released') {
			throw appError('INVALID_STATE', 'That container is not in free time.');
		}
		return { freeTimeEndsAt: c.freeTimeEndsAt, now: await productNow(ctx) };
	}
});

/** Jump the clock to one second after this container's free time ends. */
export const jumpToFreeTimeEnd = action({
	args: { sessionToken: v.string(), containerId: v.id('containers') },
	handler: async (ctx, a): Promise<AdvanceResult> => {
		requireDemoSim();
		const { freeTimeEndsAt, now } = await ctx.runQuery(internal.demo.freeTimeEndOf, a);
		const ms = freeTimeEndsAt + 1000 - now;
		if (ms <= 0) throw appError('INVALID_STATE', 'Free time has already ended for this container.');
		return advance(ctx, ms);
	}
});

const STRANGER = simAddress('stranger:demo');

export const strangerPlan = internalQuery({
	args: { sessionToken: v.string(), lineOrgId: v.id('organizations') },
	handler: async (ctx, a): Promise<{ target: string; viaContainer: string | null; stranger: string }> => {
		await requireSession(ctx, a.sessionToken);
		const line = await ctx.db.get(a.lineOrgId);
		if (!line || line.kind !== 'line' || !line.depositsAccount) throw appError('NOT_FOUND', 'Line not found.');
		const waiting = await ctx.db
			.query('containers')
			.withIndex('by_line_state', (q) => q.eq('lineOrgId', line._id).eq('state', 'awaiting_deposit'))
			.first();
		return { target: waiting?.depositAddress ?? line.depositsAccount, viaContainer: waiting?.number ?? null, stranger: STRANGER };
	}
});

export const ingestStranger = internalMutation({
	args: { receipts: v.any(), txHash: v.string(), finalityMs: v.number(), blockNumber: v.string() },
	handler: async (ctx, a): Promise<{ heldTransferIds: Id<'heldTransfers'>[]; reasons: string[] }> => {
		const r = await ingestReceipts(ctx, a.receipts as HeldReceiptJson[], {
			mode: 'sim',
			finalityMs: a.finalityMs,
			now: await productNow(ctx),
			blockNumber: a.blockNumber
		});
		const reasons: string[] = [];
		for (const id of r.heldTransfers) {
			const h = await ctx.db.get(id);
			if (h) reasons.push(h.reason);
		}
		return { heldTransferIds: r.heldTransfers, reasons };
	}
});

/**
 * A stranger pays the line's deposit address with BetaUSD (wrong token) or with AlphaUSD from an
 * unknown sender. The receive policy holds it in the guard; it shows up under Held transfers.
 */
export const sendStrangerTransfer = action({
	args: { sessionToken: v.string(), lineOrgId: v.id('organizations'), token: v.union(v.literal('BetaUSD'), v.literal('AlphaUSD')) },
	handler: async (
		ctx,
		a
	): Promise<{ txHash: string; reason: string | null; heldTransferId: Id<'heldTransfers'> | null; amountUnits: string; token: string }> => {
		requireDemoSim();
		const plan = await ctx.runQuery(internal.demo.strangerPlan, { sessionToken: a.sessionToken, lineOrgId: a.lineOrgId });
		const amount = a.token === 'BetaUSD' ? toUnits('250.00') : toUnits('175.00');
		const token = a.token === 'BetaUSD' ? BETA_USD : ALPHA_USD;
		await ctx.runMutation(internal.sim.fund, { address: plan.stranger });
		const res = await ctx.runMutation(internal.sim.transferBatch, {
			from: plan.stranger,
			token,
			calls: [{ to: plan.target, amountUnits: amount.toString(), memo: encodeMemo(plan.viaContainer ? `STRANGER ${plan.viaContainer}` : 'STRANGER TRANSFER') }]
		});
		if (!res.ok) throw appError('CHAIN_ERROR', res.error.message, { name: res.error.name });
		const rec = await ctx.runMutation(internal.demo.ingestStranger, {
			receipts: res.held,
			txHash: res.tx.txHash,
			finalityMs: res.tx.finalityMs,
			blockNumber: res.tx.blockNumber
		});
		return {
			txHash: res.tx.txHash,
			reason: rec.reasons[0] ?? null,
			heldTransferId: rec.heldTransferIds[0] ?? null,
			amountUnits: amount.toString(),
			token: a.token
		};
	}
});

// --- second same-day pull -----------------------------------------------------------------

export const secondPullPlan = internalQuery({
	args: { sessionToken: v.string(), containerId: v.id('containers') },
	handler: async (
		ctx,
		a
	): Promise<{
		account: string;
		keyAddress: string;
		encPrivKey: string;
		to: string;
		amountUnits: string;
		day: number;
		billOfLading: string;
		number: string;
		lastPullAt: number | null;
		now: number;
	}> => {
		const s = await requireLine(ctx, a.sessionToken);
		const c = await ctx.db.get(a.containerId);
		if (!c || c.lineOrgId !== s.org._id) throw appError('NOT_FOUND', 'Container not found.');
		if (c.mode !== 'depositFree' || !c.accessKeyId) throw appError('INVALID_STATE', 'Only deposit-free containers have an access key to pull with.');
		const key = await ctx.db.get(c.accessKeyId);
		if (!key || key.status !== 'active') throw appError('INVALID_STATE', 'The access key is not active.');
		if (c.state !== 'in_detention' && c.state !== 'in_free_time') throw appError('INVALID_STATE', 'The container must be past free time to pull detention.');
		const pulls = (
			await ctx.db
				.query('payments')
				.withIndex('by_container', (q) => q.eq('containerId', c._id))
				.collect()
		).filter((p) => p.kind === 'detention_pull' && p.status === 'confirmed');
		const request = await ctx.db.get(c.requestId);
		return {
			account: key.account,
			keyAddress: key.keyAddress,
			encPrivKey: key.encPrivKey,
			to: s.org.chargesAddress ?? key.recipient,
			amountUnits: c.dailyRateUnits,
			day: c.detentionDays,
			billOfLading: request?.billOfLading ?? '',
			number: c.number,
			lastPullAt: pulls.length ? Math.max(...pulls.map((p) => p.timestamp)) : null,
			now: await productNow(ctx)
		};
	}
});

export const logPullAttempt = internalMutation({
	args: {
		containerId: v.id('containers'),
		memo: v.string(),
		memoHex: v.string(),
		amountUnits: v.string(),
		account: v.string(),
		to: v.string(),
		day: v.number(),
		error: v.optional(v.string()),
		tx: v.optional(v.any())
	},
	handler: async (ctx, a): Promise<null> => {
		const c = await ctx.db.get(a.containerId);
		if (!c) return null;
		const now = await productNow(ctx);
		const tx = a.tx as { txHash: string; mode: 'sim' | 'live'; blockNumber: string; finalityMs: number; timestamp: number } | undefined;
		await ctx.db.insert('payments', {
			kind: 'detention_pull',
			mode: tx?.mode ?? 'sim',
			containerId: c._id,
			requestId: c.requestId,
			lineOrgId: c.lineOrgId,
			importerOrgId: c.importerOrgId,
			from: a.account,
			to: a.to,
			token: ALPHA_USD,
			amountUnits: a.amountUnits,
			memo: a.memo,
			memoHex: a.memoHex,
			txHash: tx?.txHash ?? '',
			blockNumber: tx?.blockNumber,
			finalityMs: tx?.finalityMs ?? 0,
			timestamp: tx?.timestamp ?? now,
			status: tx ? 'confirmed' : 'failed',
			error: a.error,
			day: a.day
		});
		if (tx) {
			await ctx.db.patch(c._id, { pulledUnits: (u(c.pulledUnits) + u(a.amountUnits)).toString() });
			await logEvent(ctx, c._id, 'detention_pull', 'Extra detention pull accepted by the chain', now, a.memo);
		} else {
			await logEvent(
				ctx,
				c._id,
				'pull_refused',
				'Second pull refused by the chain',
				now,
				`The line tried to pull ${formatUsd(u(a.amountUnits))} again within the same day. Tempo's recurring limit refused it (SpendingLimitExceeded). No transaction was recorded.`
			);
			await notify(ctx, {
				orgId: c.importerOrgId,
				kind: 'pull_refused',
				title: `Extra pull refused: ${c.number}`,
				body: 'The chain refused a second detention pull on the same day. Your access key cap held.',
				containerId: c._id,
				at: now
			});
		}
		return null;
	}
});

export type SecondPullResult =
	| { refused: true; error: 'SpendingLimitExceeded'; remainingUnits: string; periodEnd: number; attemptedUnits: string; day: number }
	| { refused: false; txHash: string; attemptedUnits: string; day: number };

/**
 * The line tries a second detention pull on the same day. The CHAIN refuses it (the 1-day recurring
 * limit on the importer's access key); the attempt is logged as a failed row in the memo trail.
 */
export const trySecondPull = action({
	args: { sessionToken: v.string(), containerId: v.id('containers') },
	handler: async (ctx, a): Promise<SecondPullResult> => {
		if (!demoEnabled()) throw appError('DEMO_DISABLED', 'Demo controls are turned off.');
		// Make sure today's regular pull has happened first.
		await ctx.runQuery(internal.demo.guard, { sessionToken: a.sessionToken });
		await runDetention(ctx, a.containerId);
		const plan = await ctx.runQuery(internal.demo.secondPullPlan, a);
		if (plan.day < 1) throw appError('INVALID_STATE', 'No detention day has started yet. Move the clock past the end of free time first.');
		const memo = pullMemo(plan.number, plan.day, plan.billOfLading);
		const memoHex = encodeMemo(memo) as Hex;
		// Sim: attempt just after the day's regular pull so the attempt falls in the same limit period.
		const at = chainMode() === 'sim' ? (plan.lastPullAt !== null && plan.now - plan.lastPullAt < DAY_MS ? plan.lastPullAt + 1000 : plan.now) : undefined;
		const res = await chainPull(ctx, {
			account: plan.account,
			keyAddress: plan.keyAddress,
			encPrivKey: plan.encPrivKey,
			to: plan.to,
			amountUnits: plan.amountUnits,
			memo: memoHex,
			at
		});
		if (!res.ok && res.error.name === 'SpendingLimitExceeded') {
			await ctx.runMutation(internal.demo.logPullAttempt, {
				containerId: a.containerId,
				memo,
				memoHex,
				amountUnits: plan.amountUnits,
				account: plan.account,
				to: plan.to,
				day: plan.day,
				error: 'SpendingLimitExceeded'
			});
			return {
				refused: true,
				error: 'SpendingLimitExceeded',
				remainingUnits: res.error.remainingUnits ?? '0',
				periodEnd: res.error.periodEnd ?? 0,
				attemptedUnits: plan.amountUnits,
				day: plan.day
			};
		}
		if (!res.ok) throw appError('CHAIN_ERROR', res.error.message, { name: res.error.name });
		await ctx.runMutation(internal.demo.logPullAttempt, {
			containerId: a.containerId,
			memo,
			memoHex,
			amountUnits: plan.amountUnits,
			account: plan.account,
			to: plan.to,
			day: plan.day,
			tx: res.tx
		});
		return { refused: false, txHash: res.tx.txHash, attemptedUnits: plan.amountUnits, day: plan.day };
	}
});

// --- reset ---------------------------------------------------------------------------------

const TABLES = [
	'sim_events',
	'sim_receipts',
	'sim_keys',
	'sim_balances',
	'sim_masters',
	'sim_meta',
	'payments',
	'containerEvents',
	'accessKeys',
	'heldTransfers',
	'disputes',
	'notifications',
	'jobRuns',
	'containers',
	'releaseRequests',
	'relationships',
	'rateCards',
	'sessions',
	'challenges',
	'users',
	'organizations'
] as const;

/** Delete up to `limit` rows across the demo tables. Returns 1 while rows may remain, 0 when empty. */
export const wipeChunk = internalMutation({
	args: { limit: v.number() },
	handler: async (ctx, a): Promise<number> => {
		let budget = a.limit;
		for (const table of TABLES) {
			if (budget <= 0) return 1;
			const rows = await ctx.db.query(table).take(budget);
			for (const r of rows) await ctx.db.delete(r._id);
			budget -= rows.length;
		}
		return budget <= 0 ? 1 : 0;
	}
});

/** Wipe everything and reseed the demo world. Sim only. */
export const reset = action({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx): Promise<{ seeded: boolean }> => {
		requireDemoSim();
		for (let i = 0; i < 200; i++) {
			const left = await ctx.runMutation(internal.demo.wipeChunk, { limit: 1500 });
			if (left === 0) break;
		}
		await ctx.runMutation(internal.seed.run, {});
		return { seeded: true };
	}
});

export { chainPayBatch };
