import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import {
	action,
	internalMutation,
	internalQuery,
	mutation,
	query,
	type QueryCtx
} from './_generated/server';
import {
	appError,
	loadContainerFor,
	logEvent,
	notify,
	productNow,
	requireImporter,
	requireLine,
	requireSession
} from './helpers';
import { checkSilentLine, contestReturnOp, recordReturnOp } from './opsLifecycle';
import { executeSettlements, throwIfNotDone, type SettleOutcome } from './settlement';
import { containerView, publicKey, publicOrg, termsFor, type ContainerView } from './views';
import { containerState } from './schema';
import { explorerTxUrl } from '../lib/shared/tempo/adapter';
import { accrued, detentionDaysAt, settlementAmounts } from '../lib/shared/domain/rules';
import { formatUsd, u } from '../lib/shared/domain/money';

function paymentView(p: Doc<'payments'>) {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const { receipt, ...rest } = p;
	return {
		...rest,
		displayHash: p.txHash ? (p.mode === 'sim' ? `sim:${p.txHash}` : p.txHash) : '',
		explorerUrl: p.mode === 'live' && p.txHash ? explorerTxUrl(p.txHash) : null
	};
}

/** Provisional numbers for the settle UI: what settlement would pay if run now. */
async function settlementPreview(ctx: QueryCtx, c: Doc<'containers'>, now: number) {
	if (c.freeTimeEndsAt === undefined) return null;
	const days = detentionDaysAt(
		{
			freeTimeEndsAt: c.freeTimeEndsAt,
			maxDetentionDays: c.maxDetentionDays,
			returnedAt: c.returnedAt
		},
		now
	);
	const accruedNow = accrued({
		days,
		dailyRateUnits: c.dailyRateUnits,
		depositUnits: c.depositUnits
	});
	const damage = u(c.damageUnits ?? '0');
	const held = u(c.receivedUnits ?? '0');
	const a = settlementAmounts({
		heldUnits: c.mode === 'held' ? held : u(c.depositUnits),
		depositUnits: c.depositUnits,
		accruedUnits: accruedNow,
		damageUnits: damage
	});
	return {
		asOf: now,
		detentionDays: days,
		accruedUnits: accruedNow.toString(),
		damageUnits: damage.toString(),
		maxChargeUnits: a.chargeUnits.toString(),
		refundUnits: c.mode === 'held' ? a.refundUnits.toString() : '0',
		pulledUnits: c.pulledUnits,
		uncollectedUnits:
			c.mode === 'depositFree'
				? (accruedNow > u(c.pulledUnits) ? accruedNow - u(c.pulledUnits) : 0n).toString()
				: '0'
	};
}

/** Everything the container detail page shows. `c` must already be authorized for the caller. */
async function containerDetail(ctx: QueryCtx, c: Doc<'containers'>) {
	const view = await containerView(ctx, c);
	const request = await ctx.db.get(c.requestId);
	const line = await ctx.db.get(c.lineOrgId);
	const importer = await ctx.db.get(c.importerOrgId);
	if (!request || !line || !importer) throw appError('NOT_FOUND', 'Container not found.');
	const payments = await ctx.db
		.query('payments')
		.withIndex('by_container', (q) => q.eq('containerId', c._id))
		.collect();
	const events = await ctx.db
		.query('containerEvents')
		.withIndex('by_container', (q) => q.eq('containerId', c._id))
		.collect();
	const dispute = c.disputeId ? await ctx.db.get(c.disputeId) : null;
	const now = await productNow(ctx);
	return {
		container: view,
		request,
		line: publicOrg(line),
		importer: publicOrg(importer),
		terms: termsFor(line, request),
		payments: payments
			.sort((x, y) => x.timestamp - y.timestamp || x._creationTime - y._creationTime)
			.map(paymentView),
		events: events.sort((x, y) => x.at - y.at),
		accessKey:
			view.accessKey ?? (c.accessKeyId ? publicKey((await ctx.db.get(c.accessKeyId))!) : null),
		dispute,
		preview: await settlementPreview(ctx, c, now),
		simNow: now
	};
}

/**
 * One container with its request, terms, memo trail, lifecycle events, access key and dispute.
 * Visible to its line, its importer and, when the container has a dispute, the platform resolver.
 */
export const get = query({
	args: { sessionToken: v.string(), containerId: v.id('containers') },
	handler: async (ctx, a) => {
		const s = await requireSession(ctx, a.sessionToken);
		const c = await loadContainerFor(ctx, s, a.containerId);
		return containerDetail(ctx, c);
	}
});

/**
 * Same shape as `get`, looked up by container number (`/containers/[number]`). Returns null when
 * the caller cannot see a container with that number. A box can come back on a later trip, so the
 * newest visible one wins, preferring a trip that is still running.
 */
export const byNumber = query({
	args: { sessionToken: v.string(), number: v.string() },
	handler: async (ctx, a) => {
		const s = await requireSession(ctx, a.sessionToken);
		const number = a.number.replace(/[\s-]/g, '').toUpperCase();
		if (!number) return null;
		const rows = await ctx.db
			.query('containers')
			.withIndex('by_number', (q) => q.eq('number', number))
			.collect();
		const visible: Doc<'containers'>[] = [];
		for (const c of rows) {
			try {
				visible.push(await loadContainerFor(ctx, s, c._id));
			} catch {
				/* not theirs */
			}
		}
		if (visible.length === 0) return null;
		visible.sort(
			(x, y) =>
				Number(x.state === 'settled') - Number(y.state === 'settled') ||
				y._creationTime - x._creationTime
		);
		return containerDetail(ctx, visible[0]);
	}
});

const filterV = v.optional(
	v.object({
		states: v.optional(v.array(containerState)),
		mode: v.optional(v.union(v.literal('held'), v.literal('depositFree'))),
		requestId: v.optional(v.id('releaseRequests')),
		search: v.optional(v.string())
	})
);
type Filter = {
	states?: Doc<'containers'>['state'][];
	mode?: 'held' | 'depositFree';
	requestId?: Id<'releaseRequests'>;
	search?: string;
};

async function listFor(
	ctx: QueryCtx,
	rows: Doc<'containers'>[],
	filter: Filter | undefined
): Promise<ContainerView[]> {
	let list = rows;
	if (filter?.states?.length) list = list.filter((c) => filter.states!.includes(c.state));
	if (filter?.mode) list = list.filter((c) => c.mode === filter.mode);
	if (filter?.requestId) list = list.filter((c) => c.requestId === filter.requestId);
	if (filter?.search) {
		const q = filter.search.replace(/\s+/g, '').toUpperCase();
		list = list.filter((c) => c.number.includes(q));
	}
	list = list.sort((x, y) => y.stateChangedAt - x.stateChangedAt);
	const cache = new Map<string, unknown>();
	const out: ContainerView[] = [];
	for (const c of list) out.push(await containerView(ctx, c, cache));
	return out;
}

export const listForLine = query({
	args: { sessionToken: v.string(), filter: filterV },
	handler: async (ctx, a): Promise<ContainerView[]> => {
		const { org } = await requireLine(ctx, a.sessionToken);
		const rows = await ctx.db
			.query('containers')
			.withIndex('by_line', (q) => q.eq('lineOrgId', org._id))
			.collect();
		return listFor(ctx, rows, a.filter);
	}
});

export const listForImporter = query({
	args: { sessionToken: v.string(), filter: filterV },
	handler: async (ctx, a): Promise<ContainerView[]> => {
		const { org } = await requireImporter(ctx, a.sessionToken);
		const rows = await ctx.db
			.query('containers')
			.withIndex('by_importer', (q) => q.eq('importerOrgId', org._id))
			.collect();
		return listFor(ctx, rows, a.filter);
	}
});

const returnArgs = {
	containerId: v.id('containers'),
	eirNumber: v.string(),
	/** ms since epoch. Default: now. */
	date: v.optional(v.number()),
	depot: v.string()
};

function returnSummary(c: Doc<'containers'>) {
	return {
		containerId: c._id,
		number: c.number,
		state: c.state,
		returnedAt: c.returnedAt ?? null,
		settlementWindowEndsAt: c.settlementWindowEndsAt ?? null,
		detentionDays: c.detentionDays,
		accruedUnits: c.accruedUnits,
		returnReceipt: c.returnReceipt ?? null
	};
}

/** Line: record the depot's return receipt. Opens the settlement window. */
export const recordReturn = mutation({
	args: { sessionToken: v.string(), ...returnArgs },
	handler: async (ctx, a) => {
		const s = await requireLine(ctx, a.sessionToken);
		await loadContainerFor(ctx, s, a.containerId);
		const now = await productNow(ctx);
		const c = await recordReturnOp(
			ctx,
			a.containerId,
			{ eirNumber: a.eirNumber, date: a.date ?? now, depot: a.depot },
			'line',
			now,
			s.user.name
		);
		// Deposit-free: catch the daily pulls up to the return date.
		if (c.mode === 'depositFree')
			await ctx.scheduler.runAfter(0, internal.lifecycle.dailyDetention, { containerId: c._id });
		return returnSummary(c);
	}
});

/** Importer: silent-line rule. Submit the return receipt when the line never recorded it. */
export const submitReturnReceipt = mutation({
	args: { sessionToken: v.string(), ...returnArgs },
	handler: async (ctx, a) => {
		const s = await requireImporter(ctx, a.sessionToken);
		const existing = await loadContainerFor(ctx, s, a.containerId);
		const now = await productNow(ctx);
		const input = { eirNumber: a.eirNumber, date: a.date ?? now, depot: a.depot };
		await checkSilentLine(ctx, existing, { ...input, date: Math.min(input.date, now) }, now);
		const c = await recordReturnOp(ctx, a.containerId, input, 'importer', now, s.user.name);
		if (c.mode === 'depositFree')
			await ctx.scheduler.runAfter(0, internal.lifecycle.dailyDetention, { containerId: c._id });
		return returnSummary(c);
	}
});

/** Line: contest an importer-submitted receipt inside the window. */
export const contestReturnReceipt = mutation({
	args: { sessionToken: v.string(), containerId: v.id('containers'), note: v.optional(v.string()) },
	handler: async (ctx, a) => {
		const s = await requireLine(ctx, a.sessionToken);
		const c = await loadContainerFor(ctx, s, a.containerId);
		await contestReturnOp(ctx, c, a.note?.trim() ?? '', await productNow(ctx), s.user.name);
		const fresh = await ctx.db.get(c._id);
		return returnSummary(fresh!);
	}
});

export const authLine = internalQuery({
	args: { sessionToken: v.string(), containerIds: v.array(v.id('containers')) },
	handler: async (ctx, a): Promise<string> => {
		const s = await requireLine(ctx, a.sessionToken);
		for (const id of a.containerIds) await loadContainerFor(ctx, s, id);
		return s.user.name;
	}
});

export const authAny = internalQuery({
	args: { sessionToken: v.string(), containerId: v.id('containers') },
	handler: async (ctx, a): Promise<{ actor: string; role: 'line' | 'importer' | 'platform' }> => {
		const s = await requireSession(ctx, a.sessionToken);
		await loadContainerFor(ctx, s, a.containerId);
		return { actor: s.user.name, role: s.org.kind };
	}
});

export const authImporter = internalQuery({
	args: { sessionToken: v.string(), containerId: v.id('containers') },
	handler: async (ctx, a): Promise<{ actor: string; userId: Id<'users'> }> => {
		const s = await requireImporter(ctx, a.sessionToken);
		await loadContainerFor(ctx, s, a.containerId);
		return { actor: s.user.name, userId: s.user._id };
	}
});

export const postOnly = internalMutation({
	args: {
		containerId: v.id('containers'),
		damageUnits: v.string(),
		note: v.optional(v.string()),
		actor: v.string()
	},
	handler: async (ctx, a): Promise<SettleOutcome> => {
		const c = await ctx.db.get(a.containerId);
		if (!c) throw appError('NOT_FOUND', 'Container not found.');
		if (c.state !== 'returned')
			throw appError('INVALID_STATE', 'Record the return of the empty before posting charges.');
		const now = await productNow(ctx);
		if (c.settlementWindowEndsAt !== undefined && now >= c.settlementWindowEndsAt) {
			throw appError(
				'WINDOW_CLOSED',
				'The window to post charges has closed; settlement proceeds with accrued detention.'
			);
		}
		const damage = u(a.damageUnits);
		if (damage < 0n) throw appError('INVALID', 'Damage cannot be negative.');
		await ctx.db.patch(c._id, {
			damageUnits: damage.toString(),
			chargeNote: a.note,
			chargesPostedAt: now
		});
		await logEvent(
			ctx,
			c._id,
			'charges_posted',
			'Final charges posted',
			now,
			`Damage ${formatUsd(damage)}${a.note ? `: ${a.note}` : ''}. The importer can accept or dispute before the window ends.`,
			a.actor
		);
		await notify(ctx, {
			orgId: c.importerOrgId,
			kind: 'charges_posted',
			title: `Charges posted: ${c.number}`,
			body: `Damage ${formatUsd(damage)}${a.note ? ` (${a.note})` : ''}. Accept to settle now, or dispute once before the window ends.`,
			containerId: c._id,
			at: now
		});
		return { containerId: c._id, number: c.number, status: 'posted' };
	}
});

/**
 * Line: post final charges for a returned container. Charge = min(deposit, accrued detention +
 * damage). By default this settles immediately: charges to the line, the remainder back to the importer
 * in one transaction. Pass `settleNow: false` to post for review: the importer then accepts or
 * disputes (once) before the window ends, or the window-end job settles.
 */
export const postCharges = action({
	args: {
		sessionToken: v.string(),
		containerId: v.id('containers'),
		damageUnits: v.optional(v.string()),
		note: v.optional(v.string()),
		settleNow: v.optional(v.boolean())
	},
	handler: async (ctx, a): Promise<SettleOutcome> => {
		const actor = await ctx.runQuery(internal.containers.authLine, {
			sessionToken: a.sessionToken,
			containerIds: [a.containerId]
		});
		const damageUnits = a.damageUnits ?? '0';
		if (a.settleNow === false) {
			return ctx.runMutation(internal.containers.postOnly, {
				containerId: a.containerId,
				damageUnits,
				note: a.note,
				actor
			});
		}
		const [o] = await executeSettlements(ctx, {
			containerIds: [a.containerId],
			source: 'line',
			actor,
			damageUnits,
			note: a.note
		});
		return throwIfNotDone(o);
	}
});

/** Line: batch settlement of returned containers (one transaction for all held ones). Accrued detention, no damage. */
export const settleMany = action({
	args: { sessionToken: v.string(), containerIds: v.array(v.id('containers')) },
	handler: async (
		ctx,
		a
	): Promise<{
		outcomes: SettleOutcome[];
		settled: number;
		skipped: number;
		txHash: string | null;
		finalityMs: number | null;
	}> => {
		if (a.containerIds.length === 0) throw appError('INVALID', 'Select at least one container.');
		const actor = await ctx.runQuery(internal.containers.authLine, a);
		const outcomes = await executeSettlements(ctx, {
			containerIds: a.containerIds,
			source: 'batch',
			actor
		});
		const done = outcomes.filter((o) => o.status === 'settled' || o.status === 'disputed');
		return {
			outcomes,
			settled: done.length,
			skipped: outcomes.length - done.length,
			txHash: done.find((o) => o.txHash)?.txHash ?? null,
			finalityMs: done.find((o) => o.finalityMs !== undefined)?.finalityMs ?? null
		};
	}
});

/** Anyone involved (line or importer), once the window has ended: settle with accrued detention. */
export const triggerSettlement = action({
	args: { sessionToken: v.string(), containerId: v.id('containers') },
	handler: async (ctx, a): Promise<SettleOutcome> => {
		const { actor } = await ctx.runQuery(internal.containers.authAny, a);
		const [o] = await executeSettlements(ctx, {
			containerIds: [a.containerId],
			source: 'window',
			actor
		});
		return throwIfNotDone(o);
	}
});

/** Importer: accept the posted charges and settle now. */
export const acceptCharges = action({
	args: { sessionToken: v.string(), containerId: v.id('containers') },
	handler: async (ctx, a): Promise<SettleOutcome> => {
		const { actor } = await ctx.runQuery(internal.containers.authImporter, a);
		const [o] = await executeSettlements(ctx, {
			containerIds: [a.containerId],
			source: 'importer',
			actor
		});
		return throwIfNotDone(o);
	}
});
