/** Dashboards (details 11.9), computed from tables. Money as base-unit strings. */
import { v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import { query } from './_generated/server';
import { productNow, requireImporter, requireLine } from './helpers';
import { DAY_MS } from '../lib/shared/domain/constants';
import { settlementAmounts } from '../lib/shared/domain/rules';
import { u } from '../lib/shared/domain/money';

const HELD_STATES: Doc<'containers'>['state'][] = ['deposit_held', 'released', 'in_free_time', 'in_detention', 'returned', 'settling'];
const LIVE_FREE_STATES: Doc<'containers'>['state'][] = ['authorized', 'released', 'in_free_time', 'in_detention', 'returned', 'settling'];

export interface SeriesPoint {
	/** ISO date (UTC) of the end of the bucket. */
	day: string;
	/** End of the bucket, ms. */
	t: number;
	valueUnits: string;
}

type Ev = { t: number; delta: bigint };

/** 30 rolling 24h buckets ending at `now`. 'cumulative' = running total at bucket end; 'sum' = total inside the bucket. */
function series(now: number, events: Ev[], kind: 'cumulative' | 'sum', days = 30): SeriesPoint[] {
	const out: SeriesPoint[] = [];
	for (let i = days - 1; i >= 0; i--) {
		const end = now - i * DAY_MS;
		const start = end - DAY_MS;
		let total = 0n;
		for (const e of events) {
			if (kind === 'cumulative' ? e.t <= end : e.t > start && e.t <= end) total += e.delta;
		}
		out.push({ day: new Date(end).toISOString().slice(0, 10), t: end, valueUnits: total.toString() });
	}
	return out;
}

const isHeldFlow = (p: Doc<'payments'>): boolean => p.status === 'confirmed' && p.receiptId !== undefined && p.receiptId !== '';

function heldEvents(payments: Doc<'payments'>[]): Ev[] {
	const evs: Ev[] = [];
	for (const p of payments) {
		if (!isHeldFlow(p)) continue;
		if (p.kind === 'deposit') evs.push({ t: p.timestamp, delta: u(p.amountUnits) });
		else if (p.kind === 'charge' || p.kind === 'refund' || p.kind === 'dispute_release') evs.push({ t: p.timestamp, delta: -u(p.amountUnits) });
	}
	return evs;
}

function refundEvents(payments: Doc<'payments'>[]): Ev[] {
	return payments
		.filter((p) => p.status === 'confirmed' && p.kind === 'refund')
		.map((p) => ({ t: p.timestamp, delta: u(p.amountUnits) }));
}

async function recentPayments(
	ctx: { db: import('./_generated/server').DatabaseReader },
	payments: Doc<'payments'>[],
	limit: number
) {
	const rows = payments
		.filter((p) => p.status !== 'pending' && ['deposit', 'detention_pull', 'charge', 'refund', 'dispute_release', 'key_authorized', 'held_return'].includes(p.kind))
		.sort((x, y) => y.timestamp - x.timestamp)
		.slice(0, limit);
	const out = [];
	for (const p of rows) {
		const c = p.containerId ? await ctx.db.get(p.containerId) : null;
		out.push({
			_id: p._id,
			kind: p.kind,
			status: p.status,
			amountUnits: p.amountUnits,
			memo: p.memo,
			txHash: p.txHash,
			mode: p.mode,
			timestamp: p.timestamp,
			finalityMs: p.finalityMs,
			containerId: p.containerId ?? null,
			containerNumber: c?.number ?? null
		});
	}
	return out;
}

export const importer = query({
	args: { sessionToken: v.string() },
	handler: async (ctx, a) => {
		const { org } = await requireImporter(ctx, a.sessionToken);
		const now = await productNow(ctx);
		const containers = await ctx.db
			.query('containers')
			.withIndex('by_importer', (q) => q.eq('importerOrgId', org._id))
			.collect();
		const payments = await ctx.db
			.query('payments')
			.withIndex('by_importer', (q) => q.eq('importerOrgId', org._id))
			.collect();

		let cashHeld = 0n;
		for (const c of containers) {
			if (c.mode === 'held' && HELD_STATES.includes(c.state)) cashHeld += u(c.receivedUnits ?? '0');
			else if (c.state === 'disputed' && c.disputeId) {
				const d = await ctx.db.get(c.disputeId);
				if (d && d.status === 'open') cashHeld += u(d.disputedUnits);
			}
		}
		const refunds = payments.filter((p) => p.kind === 'refund' && p.status === 'confirmed');
		const freed30 = refunds.filter((p) => p.timestamp > now - 30 * DAY_MS).reduce((t, p) => t + u(p.amountUnits), 0n);
		const freedTotal = refunds.reduce((t, p) => t + u(p.amountUnits), 0n);
		const timings = containers
			.filter((c) => c.mode === 'held' && c.settledAt !== undefined && c.returnedAt !== undefined)
			.map((c) => c.settledAt! - c.returnedAt!);
		const avg = timings.length ? Math.round(timings.reduce((t, x) => t + x, 0) / timings.length) : null;
		const keys = await Promise.all(
			containers
				.filter((c) => c.mode === 'depositFree' && c.accessKeyId && LIVE_FREE_STATES.includes(c.state))
				.map((c) => ctx.db.get(c.accessKeyId!))
		);
		const activeKeys = keys.filter((k): k is Doc<'accessKeys'> => k !== null && k.status === 'active');
		const detentionPaid = payments
			.filter((p) => p.status === 'confirmed' && (p.kind === 'detention_pull' || p.kind === 'charge'))
			.reduce((t, p) => t + u(p.amountUnits), 0n);
		return {
			now,
			cashHeldUnits: cashHeld.toString(),
			cashFreedThisMonthUnits: freed30.toString(),
			cashFreedTotalUnits: freedTotal.toString(),
			avgReturnToRefundMs: avg,
			refundCount: timings.length,
			awaitingDeposit: containers.filter((c) => c.state === 'awaiting_deposit' || c.state === 'requested').length,
			inFreeTime: containers.filter((c) => c.state === 'in_free_time' || c.state === 'released').length,
			inDetention: containers.filter((c) => c.state === 'in_detention').length,
			awaitingSettlement: containers.filter((c) => c.state === 'returned' || c.state === 'settling').length,
			disputed: containers.filter((c) => c.state === 'disputed').length,
			settled: containers.filter((c) => c.state === 'settled').length,
			containersTotal: containers.length,
			depositFree: {
				activeKeys: activeKeys.length,
				dailyCapTotalUnits: activeKeys.reduce((t, k) => t + u(k.dailyLimitUnits), 0n).toString()
			},
			detentionPaidUnits: detentionPaid.toString(),
			upcoming: containers
				.filter((c) => c.state === 'in_free_time' && c.freeTimeEndsAt !== undefined)
				.sort((x, y) => x.freeTimeEndsAt! - y.freeTimeEndsAt!)
				.slice(0, 6)
				.map((c) => ({ containerId: c._id, number: c.number, mode: c.mode, freeTimeEndsAt: c.freeTimeEndsAt!, dailyRateUnits: c.dailyRateUnits })),
			recent: await recentPayments(ctx, payments, 8),
			series: {
				cashHeldPerDay: series(now, heldEvents(payments), 'cumulative'),
				refundsPerDay: series(now, refundEvents(payments), 'sum')
			}
		};
	}
});

export const line = query({
	args: { sessionToken: v.string() },
	handler: async (ctx, a) => {
		const { org } = await requireLine(ctx, a.sessionToken);
		const now = await productNow(ctx);
		const containers = await ctx.db
			.query('containers')
			.withIndex('by_line', (q) => q.eq('lineOrgId', org._id))
			.collect();
		const payments = await ctx.db
			.query('payments')
			.withIndex('by_line', (q) => q.eq('lineOrgId', org._id))
			.collect();

		let depositsHeld = 0n;
		let exposure = 0n;
		let uncollected = 0n;
		let dailyCap = 0n;
		let activeKeys = 0;
		const refundsDue = [];
		for (const c of containers) {
			if (c.mode === 'held' && HELD_STATES.includes(c.state)) depositsHeld += u(c.receivedUnits ?? '0');
			if (c.state === 'disputed' && c.disputeId) {
				const d = await ctx.db.get(c.disputeId);
				if (d && d.status === 'open') depositsHeld += u(d.disputedUnits);
			}
			if (c.mode === 'depositFree' && LIVE_FREE_STATES.includes(c.state)) {
				const left = u(c.depositUnits) - u(c.pulledUnits);
				exposure += left > 0n ? left : 0n;
				const owed = u(c.accruedUnits) - u(c.pulledUnits);
				uncollected += owed > 0n ? owed : 0n;
				const key = c.accessKeyId ? await ctx.db.get(c.accessKeyId) : null;
				if (key?.status === 'active') {
					activeKeys++;
					dailyCap += u(key.dailyLimitUnits);
				}
			}
			if (c.mode === 'held' && c.state === 'returned' && c.settlementWindowEndsAt !== undefined) {
				const a2 = settlementAmounts({
					heldUnits: u(c.receivedUnits ?? '0'),
					depositUnits: c.depositUnits,
					accruedUnits: c.accruedUnits,
					damageUnits: c.damageUnits ?? '0'
				});
				const importer = await ctx.db.get(c.importerOrgId);
				refundsDue.push({
					containerId: c._id,
					number: c.number,
					importerName: importer?.name ?? '',
					deadline: c.settlementWindowEndsAt,
					amountUnits: a2.refundUnits.toString(),
					overdue: now >= c.settlementWindowEndsAt
				});
			}
		}
		refundsDue.sort((x, y) => x.deadline - y.deadline);
		const collected = payments
			.filter((p) => p.status === 'confirmed' && (p.kind === 'detention_pull' || p.kind === 'charge' || (p.kind === 'dispute_release' && p.to.toLowerCase() === (org.chargesAddress ?? '').toLowerCase())))
			.reduce((t, p) => ({ all: t.all + u(p.amountUnits), last30: t.last30 + (p.timestamp > now - 30 * DAY_MS ? u(p.amountUnits) : 0n) }), { all: 0n, last30: 0n });
		const held = await ctx.db
			.query('heldTransfers')
			.withIndex('by_line_status', (q) => q.eq('lineOrgId', org._id).eq('status', 'held'))
			.collect();
		const openDisputes = await ctx.db
			.query('disputes')
			.withIndex('by_line_status', (q) => q.eq('lineOrgId', org._id).eq('status', 'open'))
			.collect();
		const timings = containers
			.filter((c) => c.mode === 'held' && c.settledAt !== undefined && c.returnedAt !== undefined)
			.map((c) => c.settledAt! - c.returnedAt!);
		return {
			now,
			depositsHeldUnits: depositsHeld.toString(),
			depositFreeExposureUnits: exposure.toString(),
			depositFreeUncollectedUnits: uncollected.toString(),
			activeKeys,
			dailyCapTotalUnits: dailyCap.toString(),
			pastFreeTime: containers.filter((c) => c.state === 'in_detention').length,
			inFreeTime: containers.filter((c) => c.state === 'in_free_time' || c.state === 'released').length,
			awaitingDeposit: containers.filter((c) => c.state === 'awaiting_deposit').length,
			awaitingAuthorization: containers.filter((c) => c.state === 'requested').length,
			readyToRelease: containers.filter((c) => c.state === 'deposit_held' || c.state === 'authorized').length,
			awaitingSettlement: containers.filter((c) => c.state === 'returned' || c.state === 'settling').length,
			settled: containers.filter((c) => c.state === 'settled').length,
			detentionCollectedUnits: collected.all.toString(),
			detentionCollectedLast30Units: collected.last30.toString(),
			refundsDue,
			overdueRefunds: refundsDue.filter((r) => r.overdue).length,
			heldTransfers: { count: held.length, units: held.reduce((t, h) => (h.token.length ? t + (h.tokenSymbol === 'AlphaUSD' ? u(h.amountUnits) : 0n) : t), 0n).toString() },
			openDisputes: openDisputes.length,
			compliance: {
				settledCount: timings.length,
				avgReturnToRefundMs: timings.length ? Math.round(timings.reduce((t, x) => t + x, 0) / timings.length) : null,
				maxReturnToRefundMs: timings.length ? Math.max(...timings) : null,
				settlementWindowDays: org.settlementWindowDays ?? 3
			},
			recent: await recentPayments(ctx, payments, 8),
			series: {
				cashHeldPerDay: series(now, heldEvents(payments), 'cumulative'),
				refundsPerDay: series(now, refundEvents(payments), 'sum')
			}
		};
	}
});
