import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { action, internalMutation, internalQuery, query } from './_generated/server';
import { appError, loadContainerFor, productNow, requireSession } from './helpers';
import { chainResolveDispute } from './chain';
import { beginResolveOp, finishResolveOp, type ResolvePlan } from './opsSettlement';
import { executeSettlements, throwIfNotDone, type SettleOutcome } from './settlement';
import type { TxResultJson } from '../lib/shared/tempo/adapter';
import type { SimLeg } from '../lib/shared/tempo/sim';
import { u } from '../lib/shared/domain/money';

/**
 * Importer: dispute the charge on a returned container, once, inside the window. Only the
 * disputed amount stays held (in escrow with the settlement contract); the undisputed charge
 * is paid to the line and the rest refunded immediately.
 */
export const open = action({
	args: {
		sessionToken: v.string(),
		containerId: v.id('containers'),
		disputedUnits: v.string(),
		reason: v.string(),
		evidence: v.optional(v.string())
	},
	handler: async (ctx, a): Promise<SettleOutcome> => {
		const { actor, userId } = await ctx.runQuery(internal.containers.authImporter, {
			sessionToken: a.sessionToken,
			containerId: a.containerId
		});
		const reason = a.reason.trim();
		if (reason.length < 3)
			throw appError('INVALID', 'Tell the resolver why you dispute the charge.');
		if (!/^\d+$/.test(a.disputedUnits)) throw appError('INVALID', 'Enter the disputed amount.');
		const [o] = await executeSettlements(ctx, {
			containerIds: [a.containerId],
			source: 'dispute',
			actor,
			disputedUnits: a.disputedUnits,
			dispute: { openedBy: userId, reason, evidence: a.evidence?.trim() || undefined }
		});
		const done = throwIfNotDone(o);
		await ctx.runMutation(internal.disputes.markOpened, { containerId: a.containerId });
		return done;
	}
});

/** Bumps the pair's dispute counter once the dispute is live on-chain. */
export const markOpened = internalMutation({
	args: { containerId: v.id('containers') },
	handler: async (ctx, a): Promise<null> => {
		const c = await ctx.db.get(a.containerId);
		if (!c) return null;
		const rel = await ctx.db
			.query('relationships')
			.withIndex('by_pair', (q) =>
				q.eq('lineOrgId', c.lineOrgId).eq('importerOrgId', c.importerOrgId)
			)
			.unique();
		if (rel) await ctx.db.patch(rel._id, { disputes: rel.disputes + 1 });
		return null;
	}
});

export const resolvePlan = internalQuery({
	args: { sessionToken: v.string(), disputeId: v.id('disputes') },
	handler: async (ctx, a): Promise<{ actor: string; userId: Id<'users'> }> => {
		const s = await requireSession(ctx, a.sessionToken);
		const d = await ctx.db.get(a.disputeId);
		if (!d) throw appError('NOT_FOUND', 'Dispute not found.');
		if (d.resolverOrgId !== s.org._id)
			throw appError('FORBIDDEN', 'Only the agreed resolver can decide this dispute.');
		if (d.status !== 'open') throw appError('INVALID_STATE', 'This dispute is already resolved.');
		return { actor: s.user.name, userId: s.user._id };
	}
});

export const beginResolve = internalMutation({
	args: { disputeId: v.id('disputes'), toLineUnits: v.string(), note: v.string() },
	handler: async (ctx, a): Promise<ResolvePlan> =>
		beginResolveOp(ctx, { ...a, now: await productNow(ctx) })
});

export const finishResolve = internalMutation({
	args: {
		plan: v.any(),
		txs: v.any(),
		decidedBy: v.id('users'),
		note: v.string(),
		actor: v.string()
	},
	handler: async (ctx, a): Promise<null> => {
		await finishResolveOp(ctx, a.plan as ResolvePlan, {
			txs: a.txs as { receiptId: string; tx: TxResultJson; legs: SimLeg[] }[],
			now: await productNow(ctx),
			decidedBy: a.decidedBy,
			note: a.note,
			actor: a.actor
		});
		return null;
	}
});

/**
 * Resolver (the platform by default, or the line if both agreed): split the escrow between the line
 * and the importer. `toLineUnits` is the part of the disputed amount that goes to the line.
 */
export const resolve = action({
	args: {
		sessionToken: v.string(),
		disputeId: v.id('disputes'),
		toLineUnits: v.string(),
		note: v.string()
	},
	handler: async (
		ctx,
		a
	): Promise<{
		disputeId: Id<'disputes'>;
		toLineUnits: string;
		toImporterUnits: string;
		txHashes: string[];
	}> => {
		const { actor, userId } = await ctx.runQuery(internal.disputes.resolvePlan, {
			sessionToken: a.sessionToken,
			disputeId: a.disputeId
		});
		const note = a.note.trim();
		if (!note) throw appError('INVALID', 'Add a short note explaining the decision.');
		const plan = await ctx.runMutation(internal.disputes.beginResolve, {
			disputeId: a.disputeId,
			toLineUnits: a.toLineUnits,
			note
		});
		const txs: { receiptId: string; tx: TxResultJson; legs: SimLeg[] }[] = [];
		for (const item of plan.items) {
			const res = await chainResolveDispute(ctx, {
				receiptId: item.receiptId,
				receipt: item.receipt,
				toLineUnits: item.toLineUnits,
				memo: plan.memoHex
			});
			if (!res.ok) throw appError('CHAIN_ERROR', res.error.message, { name: res.error.name });
			txs.push({ receiptId: item.receiptId, tx: res.tx, legs: res.legs });
		}
		await ctx.runMutation(internal.disputes.finishResolve, {
			plan,
			txs,
			decidedBy: userId,
			note,
			actor
		});
		return {
			disputeId: a.disputeId,
			toLineUnits: plan.toLineUnits,
			toImporterUnits: plan.toImporterUnits,
			txHashes: txs.map((t) => t.tx.txHash)
		};
	}
});

export const list = query({
	args: {
		sessionToken: v.string(),
		status: v.optional(v.union(v.literal('open'), v.literal('resolved')))
	},
	handler: async (ctx, a) => {
		const s = await requireSession(ctx, a.sessionToken);
		const statuses: ('open' | 'resolved')[] = a.status ? [a.status] : ['open', 'resolved'];
		let rows: Doc<'disputes'>[] = [];
		for (const st of statuses) {
			const part =
				s.org.kind === 'line'
					? await ctx.db
							.query('disputes')
							.withIndex('by_line_status', (q) => q.eq('lineOrgId', s.org._id).eq('status', st))
							.collect()
					: s.org.kind === 'importer'
						? await ctx.db
								.query('disputes')
								.withIndex('by_importer_status', (q) =>
									q.eq('importerOrgId', s.org._id).eq('status', st)
								)
								.collect()
						: await ctx.db
								.query('disputes')
								.withIndex('by_resolver_status', (q) =>
									q.eq('resolverOrgId', s.org._id).eq('status', st)
								)
								.collect();
			rows = rows.concat(part);
		}
		const out = [];
		for (const d of rows.sort((x, y) => y.openedAt - x.openedAt)) {
			const c = await ctx.db.get(d.containerId);
			const imp = await ctx.db.get(d.importerOrgId);
			const line = await ctx.db.get(d.lineOrgId);
			const req = c ? await ctx.db.get(c.requestId) : null;
			const opener = await ctx.db.get(d.openedBy);
			out.push({
				...d,
				receiptEscrows: undefined,
				containerNumber: c?.number ?? '',
				containerType: c?.type ?? null,
				billOfLading: req?.billOfLading ?? '',
				importerName: imp?.name ?? '',
				lineName: line?.name ?? '',
				openedByName: opener?.name ?? '',
				chargesUnits: c?.chargesUnits ?? '0',
				canResolve: d.status === 'open' && d.resolverOrgId === s.org._id,
				escrowUnits: d.status === 'open' ? d.disputedUnits : '0'
			});
		}
		return out;
	}
});

export const get = query({
	args: { sessionToken: v.string(), disputeId: v.id('disputes') },
	handler: async (ctx, a) => {
		const s = await requireSession(ctx, a.sessionToken);
		const d = await ctx.db.get(a.disputeId);
		if (!d) return null;
		if (d.resolverOrgId !== s.org._id && d.lineOrgId !== s.org._id && d.importerOrgId !== s.org._id)
			return null;
		const c = await loadContainerFor(ctx, s, d.containerId);
		const payments = await ctx.db
			.query('payments')
			.withIndex('by_container', (q) => q.eq('containerId', c._id))
			.collect();
		return {
			dispute: { ...d, receiptEscrows: undefined },
			container: {
				_id: c._id,
				number: c.number,
				type: c.type,
				chargesUnits: c.chargesUnits ?? '0',
				refundUnits: c.refundUnits ?? '0',
				state: c.state
			},
			payments: payments
				.filter((p) => ['charge', 'refund', 'dispute_release', 'deposit'].includes(p.kind))
				.map((p) => ({
					kind: p.kind,
					amountUnits: p.amountUnits,
					memo: p.memo,
					timestamp: p.timestamp,
					txHash: p.txHash
				})),
			escrowUnits: d.status === 'open' ? d.disputedUnits : '0',
			disputedUnits: u(d.disputedUnits).toString()
		};
	}
});
