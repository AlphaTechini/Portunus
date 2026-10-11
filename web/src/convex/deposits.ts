/**
 * Paying held deposits. The importer approves one all-or-nothing batch (one transfer per
 * container to its virtual address). Funds land in the receive-policy guard, never in the
 * line's balance; the app records what the guard holds.
 */
import { v } from 'convex/values';
import { keccak256, stringToHex } from 'viem';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { action, internalMutation, internalQuery, query, type QueryCtx } from './_generated/server';
import { appError, chainMode, lc, loadRequestFor, productNow, requireImporter, type Approval, type SessionInfo } from './helpers';
import { chainConfirmDeposits, chainPayBatch } from './chain';
import { ingestReceipts } from './opsDeposits';
import { simBalance } from './views';
import { approvalV, checkApproval } from './webauthn';
import { depositMemo, encodeMemo } from '../lib/shared/domain/memo';
import { stableJson } from '../lib/shared/tempo/sim';
import { u } from '../lib/shared/domain/money';
import type { HeldReceiptJson } from '../lib/shared/tempo/adapter';

export interface DepositPlan {
	requestId: Id<'releaseRequests'>;
	payer: string;
	mode: 'sim' | 'live';
	items: {
		containerId: Id<'containers'>;
		number: string;
		type: string;
		to: string;
		amountUnits: string;
		depositUnits: string;
		receivedUnits: string;
		missingUnits: string;
		memo: string;
		memoHex: string;
	}[];
	totalUnits: string;
	payloadHash: string;
	balanceUnits: string | null;
	sufficientBalance: boolean | null;
}

const overridesV = v.optional(v.array(v.object({ containerId: v.id('containers'), amountUnits: v.string() })));

async function buildPlan(
	ctx: QueryCtx,
	s: SessionInfo,
	requestId: Id<'releaseRequests'>,
	overrides?: { containerId: Id<'containers'>; amountUnits: string }[]
): Promise<DepositPlan> {
	const request = await loadRequestFor(ctx, s, requestId);
	if (request.mode !== 'held') throw appError('NOT_SUPPORTED', 'This request is deposit-free. Authorize the access key instead.');
	const containers = await ctx.db
		.query('containers')
		.withIndex('by_request', (q) => q.eq('requestId', request._id))
		.collect();
	const payer = lc(s.user.passkey?.address ?? s.org.tempoAddress ?? '');
	if (!payer) throw appError('INVALID', 'Your account has no Tempo address yet.');
	const items: DepositPlan['items'] = [];
	for (const c of containers.sort((x, y) => x.seq - y.seq)) {
		if (c.state !== 'awaiting_deposit') continue;
		const missing = u(c.depositUnits) - u(c.receivedUnits ?? '0');
		const ov = overrides?.find((o) => o.containerId === c._id);
		const amount = ov ? u(ov.amountUnits) : missing;
		if (ov && (amount <= 0n || !/^\d+$/.test(ov.amountUnits))) throw appError('INVALID', `Enter a positive amount for ${c.number}.`);
		if (!ov && amount <= 0n) continue;
		const memo = depositMemo(c.number, request.billOfLading);
		items.push({
			containerId: c._id,
			number: c.number,
			type: c.type,
			to: c.depositAddress,
			amountUnits: amount.toString(),
			depositUnits: c.depositUnits,
			receivedUnits: c.receivedUnits ?? '0',
			missingUnits: missing.toString(),
			memo,
			memoHex: encodeMemo(memo)
		});
	}
	if (items.length === 0) throw appError('INVALID_STATE', 'There is nothing left to pay on this request.');
	const total = items.reduce((t, i) => t + u(i.amountUnits), 0n);
	const balance = await simBalance(ctx, payer);
	const payloadHash = keccak256(
		stringToHex(stableJson({ requestId: request._id, payer, items: items.map((i) => ({ to: i.to, amount: i.amountUnits, memo: i.memoHex })) }))
	);
	return {
		requestId: request._id,
		payer,
		mode: chainMode(),
		items,
		totalUnits: total.toString(),
		payloadHash,
		balanceUnits: balance,
		sufficientBalance: balance === null ? null : u(balance) >= total
	};
}

/** Importer: what one tap will pay, plus the payload hash the passkey signs. */
export const preview = query({
	args: { sessionToken: v.string(), requestId: v.id('releaseRequests'), amountOverrides: overridesV },
	handler: async (ctx, a): Promise<DepositPlan> => {
		const s = await requireImporter(ctx, a.sessionToken);
		return buildPlan(ctx, s, a.requestId, a.amountOverrides);
	}
});

export const planInternal = internalQuery({
	args: {
		sessionToken: v.string(),
		requestId: v.id('releaseRequests'),
		amountOverrides: overridesV,
		approval: approvalV
	},
	handler: async (ctx, a): Promise<{ plan: DepositPlan; approvedWith: 'passkey' | 'demo' }> => {
		const s = await requireImporter(ctx, a.sessionToken);
		const plan = await buildPlan(ctx, s, a.requestId, a.amountOverrides);
		const { approvedWith } = checkApproval(s.user, a.approval as Approval, plan.payloadHash);
		return { plan, approvedWith };
	}
});

export interface DepositResult {
	mode: 'sim' | 'live';
	txHash: string;
	blockNumber: string;
	timestamp: number;
	finalityMs: number;
	totalUnits: string;
	allCovered: boolean;
	containers: {
		containerId: Id<'containers'>;
		number: string;
		receivedUnits: string;
		depositUnits: string;
		missingUnits: string;
		state: string;
	}[];
}

export const record = internalMutation({
	args: {
		requestId: v.id('releaseRequests'),
		receipts: v.any(),
		mode: v.union(v.literal('sim'), v.literal('live')),
		txHash: v.string(),
		blockNumber: v.string(),
		timestamp: v.number(),
		finalityMs: v.number(),
		approvedWith: v.optional(v.union(v.literal('passkey'), v.literal('demo')))
	},
	handler: async (ctx, a): Promise<DepositResult> => {
		const now = await productNow(ctx);
		const ingest = await ingestReceipts(ctx, a.receipts as HeldReceiptJson[], {
			mode: a.mode,
			finalityMs: a.finalityMs,
			now,
			blockNumber: a.blockNumber,
			approvedWith: a.approvedWith
		});
		const containers = await ctx.db
			.query('containers')
			.withIndex('by_request', (q) => q.eq('requestId', a.requestId))
			.collect();
		const rows = containers.sort((x, y) => x.seq - y.seq).map((c) => {
			const missing = u(c.depositUnits) - u(c.receivedUnits ?? '0');
			return {
				containerId: c._id,
				number: c.number,
				receivedUnits: c.receivedUnits ?? '0',
				depositUnits: c.depositUnits,
				missingUnits: (missing > 0n ? missing : 0n).toString(),
				state: c.state
			};
		});
		void ingest;
		return {
			mode: a.mode,
			txHash: a.txHash,
			blockNumber: a.blockNumber,
			timestamp: a.timestamp,
			finalityMs: a.finalityMs,
			totalUnits: ingest.deposits.reduce((t, d) => t + u(d.amountUnits), 0n).toString(),
			allCovered: rows.every((r) => u(r.missingUnits) === 0n),
			containers: rows
		};
	}
});

/**
 * Importer pays all containers of a request in one atomic batch.
 * Sim: runs the sim batch. Live: the browser already submitted the transaction; pass its `txHash`.
 */
export const payBatch = action({
	args: {
		sessionToken: v.string(),
		requestId: v.id('releaseRequests'),
		approval: approvalV,
		amountOverrides: overridesV,
		txHash: v.optional(v.string())
	},
	handler: async (ctx, a): Promise<DepositResult> => {
		const { plan, approvedWith } = await ctx.runQuery(internal.deposits.planInternal, {
			sessionToken: a.sessionToken,
			requestId: a.requestId,
			amountOverrides: a.amountOverrides,
			approval: a.approval
		});
		if (chainMode() === 'live') {
			if (!a.txHash) throw appError('NOT_SUPPORTED', 'In live mode the browser submits the batch with your passkey, then calls recordLiveBatch.');
			return confirmLive(ctx, a.requestId, a.txHash, approvedWith);
		}
		const now = await ctx.runQuery(internal.deposits.clock, {});
		const res = await chainPayBatch(ctx, {
			payer: plan.payer,
			items: plan.items.map((i) => ({ to: i.to, amountUnits: i.amountUnits, memo: i.memoHex as `0x${string}` })),
			at: now
		});
		if (!res.ok) {
			if (res.error.name === 'InsufficientBalance') {
				throw appError('INSUFFICIENT_BALANCE', 'Your account does not hold enough AlphaUSD for this batch. No deposit was taken.', {
					available: String(res.error.available ?? '0'),
					required: String(res.error.required ?? plan.totalUnits)
				});
			}
			throw appError('CHAIN_ERROR', res.error.message, { name: res.error.name });
		}
		return ctx.runMutation(internal.deposits.record, {
			requestId: a.requestId,
			receipts: res.held,
			mode: 'sim',
			txHash: res.tx.txHash,
			blockNumber: res.tx.blockNumber,
			timestamp: res.tx.timestamp,
			finalityMs: res.tx.finalityMs,
			approvedWith
		});
	}
});

export const clock = internalQuery({
	args: {},
	handler: async (ctx): Promise<number> => productNow(ctx)
});

async function confirmLive(
	ctx: Parameters<typeof chainConfirmDeposits>[0],
	requestId: Id<'releaseRequests'>,
	txHash: string,
	approvedWith: 'passkey' | 'demo'
): Promise<DepositResult> {
	const res = await chainConfirmDeposits(ctx, txHash);
	if (!res.ok) throw appError('CHAIN_ERROR', res.error.message, { name: res.error.name });
	const first = res.held[0];
	return ctx.runMutation(internal.deposits.record, {
		requestId,
		receipts: res.held,
		mode: 'live',
		txHash,
		blockNumber: '0',
		timestamp: first ? first.blockedAt : Date.now(),
		finalityMs: 0,
		approvedWith
	});
}

export const authorizeLive = internalQuery({
	args: { sessionToken: v.string(), requestId: v.id('releaseRequests') },
	handler: async (ctx, a): Promise<boolean> => {
		const s = await requireImporter(ctx, a.sessionToken);
		await loadRequestFor(ctx, s, a.requestId);
		return s.user.passkey !== undefined;
	}
});

/** Live: the browser submitted the batch; re-read the transaction on-chain and record the deposits. */
export const recordLiveBatch = action({
	args: { sessionToken: v.string(), requestId: v.id('releaseRequests'), txHash: v.string() },
	handler: async (ctx, a): Promise<DepositResult> => {
		if (chainMode() !== 'live') throw appError('NOT_SUPPORTED', 'recordLiveBatch is only used in live mode.');
		const hasPasskey = await ctx.runQuery(internal.deposits.authorizeLive, { sessionToken: a.sessionToken, requestId: a.requestId });
		return confirmLive(ctx, a.requestId, a.txHash, hasPasskey ? 'passkey' : 'demo');
	}
});
