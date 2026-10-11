/**
 * Settlement, disputes and held-transfer returns as plain mutation-context operations.
 *
 *   begin*  : validate, move the container to `settling`, return a plan for the chain step
 *   finish* : record the confirmed result
 *   fail*   : roll back so the sweep can retry (nothing is ever shown as paid before it is final)
 */
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { appError, logEvent, notify, setState, fmtDate } from './helpers';
import { refreshRequestStatus } from './opsRequests';
import {
	accrued,
	allocateCharge,
	detentionDaysAt,
	disputeSplit,
	isCleanReturn,
	settlementAmounts
} from '../lib/shared/domain/rules';
import {
	chargeMemo as chargeMemoText,
	disputeReleaseMemo,
	encodeMemo,
	heldReturnMemo as heldReturnMemoText,
	refundMemo as refundMemoText,
	type Hex
} from '../lib/shared/domain/memo';
import { formatUsd, minBig, u } from '../lib/shared/domain/money';
import type { TxResultJson } from '../lib/shared/tempo/adapter';
import type { SimLeg } from '../lib/shared/tempo/sim';
import type { ChainErr } from './chain';

export type SettleSource = 'line' | 'window' | 'importer' | 'batch' | 'dispute';

export interface SettlementItemPlan {
	receiptId: string;
	receipt: string;
	amountUnits: string;
	chargeUnits: string;
	disputedUnits: string;
	refundUnits: string;
	originator: string;
	chargeMemoHex: Hex;
	refundMemoHex: Hex;
	chargeMemo: string;
	refundMemo: string;
}

export interface SettlementPlan {
	containerId: Id<'containers'>;
	number: string;
	mode: 'held' | 'depositFree';
	source: SettleSource;
	lineOrgId: Id<'organizations'>;
	importerOrgId: Id<'organizations'>;
	requestId: Id<'releaseRequests'>;
	eir: string;
	/** Total final charge owed to the line (detention + damage, capped). */
	chargeUnits: string;
	damageUnits: string;
	accruedUnits: string;
	detentionDays: number;
	disputedUnits: string;
	/** Immediate refund to the importer. */
	refundUnits: string;
	heldUnits: string;
	cappedByDeposit: boolean;
	settlementContract: string;
	chargesAddress: string;
	items: SettlementItemPlan[];
	disputeId?: Id<'disputes'>;
	depositFree?: {
		keyId: Id<'accessKeys'>;
		account: string;
		keyAddress: string;
		encPrivKey: string;
		to: string;
		pulledUnits: string;
		damagePull?: { amountUnits: string; memo: string; memoHex: Hex };
	};
}

/**
 * pendingOnChain.step for a settlement. Only line/window/batch settlements are retried by the
 * sweep; an importer's accept or dispute failed on-chain must be re-confirmed by the importer.
 */
function settleStep(source: SettleSource): string {
	return source === 'dispute' || source === 'importer' ? 'settle:importer' : 'settle';
}

export interface BeginSettlementArgs {
	containerId: Id<'containers'>;
	now: number;
	source: SettleSource;
	/** Stated damage. Omitted: reuse what the line already posted, else none. */
	damageUnits?: string;
	note?: string;
	/** Importer dispute: part of the charge to keep in escrow. */
	disputedUnits?: string;
	dispute?: { openedBy: Id<'users'>; reason: string; evidence?: string };
	actor: string;
}

export async function beginSettlementOp(
	ctx: MutationCtx,
	a: BeginSettlementArgs
): Promise<SettlementPlan> {
	const c = await ctx.db.get(a.containerId);
	if (!c) throw appError('NOT_FOUND', 'Container not found.');
	if (c.state !== 'returned') {
		throw appError(
			'INVALID_STATE',
			c.state === 'settled' || c.state === 'settling' || c.state === 'disputed'
				? 'This container is already settled or settling.'
				: 'Record the return of the empty before settling.',
			{ state: c.state }
		);
	}
	if (!c.returnReceipt || c.returnedAt === undefined || c.freeTimeEndsAt === undefined) {
		throw appError('INVALID_STATE', 'Record the return of the empty before settling.');
	}
	if (
		a.source === 'window' &&
		c.settlementWindowEndsAt !== undefined &&
		a.now < c.settlementWindowEndsAt
	) {
		throw appError(
			'WINDOW_OPEN',
			`The settlement window is open until ${fmtDate(c.settlementWindowEndsAt)}.`
		);
	}
	if (
		a.source === 'dispute' &&
		c.settlementWindowEndsAt !== undefined &&
		a.now >= c.settlementWindowEndsAt
	) {
		throw appError('WINDOW_CLOSED', 'The dispute window has closed.');
	}
	const line = await ctx.db.get(c.lineOrgId);
	if (!line) throw appError('NOT_FOUND', 'Line not found.');
	const days = detentionDaysAt(
		{
			freeTimeEndsAt: c.freeTimeEndsAt,
			maxDetentionDays: c.maxDetentionDays,
			returnedAt: c.returnedAt
		},
		a.now
	);
	const accruedUnits = accrued({
		days,
		dailyRateUnits: c.dailyRateUnits,
		depositUnits: c.depositUnits
	});
	const damageRaw = u(a.damageUnits ?? c.damageUnits ?? '0');
	if (damageRaw < 0n) throw appError('INVALID', 'Damage cannot be negative.');
	const settlementContract = line.settlementContract ?? line.depositsAccount ?? '';
	const chargesAddress = line.chargesAddress ?? '';
	const eir = c.returnReceipt.eirNumber;
	const cMemo = chargeMemoText(c.number, eir);
	const rMemo = refundMemoText(c.number, eir);
	const base = {
		containerId: c._id,
		number: c.number,
		mode: c.mode,
		source: a.source,
		lineOrgId: c.lineOrgId,
		importerOrgId: c.importerOrgId,
		requestId: c.requestId,
		eir,
		accruedUnits: accruedUnits.toString(),
		detentionDays: days,
		settlementContract,
		chargesAddress
	};

	if (c.mode === 'held') {
		const deposits = (
			await ctx.db
				.query('payments')
				.withIndex('by_container', (q) => q.eq('containerId', c._id))
				.collect()
		)
			.filter((p) => p.kind === 'deposit' && p.status === 'confirmed' && p.receiptId && p.receipt)
			.sort((x, y) => x.timestamp - y.timestamp);
		if (deposits.length === 0)
			throw appError('INVALID_STATE', 'No held deposit was found for this container.');
		const held = deposits.reduce((s, p) => s + u(p.amountUnits), 0n);
		const disputed = u(a.disputedUnits ?? '0');
		if (a.dispute) {
			if (c.disputeId) throw appError('CONFLICT', 'Charges can be disputed only once.');
			if (disputed <= 0n) throw appError('INVALID', 'Enter the amount you dispute.');
		}
		let amounts: ReturnType<typeof settlementAmounts>;
		try {
			amounts = settlementAmounts({
				heldUnits: held,
				depositUnits: c.depositUnits,
				accruedUnits,
				damageUnits: damageRaw,
				disputedUnits: disputed
			});
		} catch (e) {
			throw appError('INVALID', e instanceof Error ? e.message : 'Invalid amounts.');
		}
		const alloc = allocateCharge(
			deposits.map((p) => p.amountUnits),
			amounts.chargeUnits,
			disputed
		);
		const items: SettlementItemPlan[] = [];
		deposits.forEach((p, i) => {
			items.push({
				receiptId: p.receiptId!,
				receipt: p.receipt!,
				amountUnits: p.amountUnits,
				chargeUnits: (alloc[i].charge - alloc[i].disputed).toString(),
				disputedUnits: alloc[i].disputed.toString(),
				refundUnits: alloc[i].refund.toString(),
				originator: p.from,
				chargeMemoHex: encodeMemo(cMemo),
				refundMemoHex: encodeMemo(rMemo),
				chargeMemo: cMemo,
				refundMemo: rMemo
			});
		});
		let disputeId: Id<'disputes'> | undefined;
		if (a.dispute) {
			disputeId = await ctx.db.insert('disputes', {
				containerId: c._id,
				openedBy: a.dispute.openedBy,
				importerOrgId: c.importerOrgId,
				lineOrgId: c.lineOrgId,
				disputedUnits: disputed.toString(),
				reason: a.dispute.reason,
				evidence: a.dispute.evidence,
				status: 'open',
				resolverOrgId: (await resolverFor(ctx, c))!,
				receiptEscrows: items
					.filter((i) => u(i.disputedUnits) > 0n)
					.map((i) => ({
						receiptId: i.receiptId,
						receipt: i.receipt,
						escrowUnits: i.disputedUnits
					})),
				openedAt: a.now
			});
		}
		const prev = c.pendingOnChain;
		await ctx.db.patch(c._id, {
			state: 'settling',
			stateChangedAt: a.now,
			chargesUnits: amounts.chargeUnits.toString(),
			damageUnits: damageRaw.toString(),
			chargeNote: a.note ?? c.chargeNote,
			chargesPostedAt: c.chargesPostedAt ?? a.now,
			disputeId: disputeId ?? c.disputeId,
			pendingOnChain: {
				step: settleStep(a.source),
				since: prev?.step === settleStep(a.source) ? prev.since : a.now,
				attempts: prev?.step === settleStep(a.source) ? prev.attempts + 1 : 1,
				lastError: undefined
			}
		});
		return {
			...base,
			chargeUnits: amounts.chargeUnits.toString(),
			damageUnits: damageRaw.toString(),
			disputedUnits: disputed.toString(),
			refundUnits: amounts.refundUnits.toString(),
			heldUnits: held.toString(),
			cappedByDeposit: accruedUnits + damageRaw > u(c.depositUnits),
			items,
			disputeId
		};
	}

	// Deposit-free: detention was collected daily. Settlement finalises, optionally pulls damage, revokes the key.
	if (a.disputedUnits && u(a.disputedUnits) > 0n) {
		throw appError(
			'NOT_SUPPORTED',
			'Deposit-free pulls are final; there is no held deposit to dispute against.'
		);
	}
	const key = c.accessKeyId ? await ctx.db.get(c.accessKeyId) : null;
	if (!key) throw appError('INVALID_STATE', 'No access key found for this container.');
	if (c.detentionDays < days) {
		throw appError(
			'INVALID_STATE',
			'Detention pulls are still catching up. Try again in a moment.',
			{
				processed: c.detentionDays,
				due: days
			}
		);
	}
	const pulled = u(c.pulledUnits);
	let damage = damageRaw;
	if (damage > 0n) {
		const cap = u(key.dailyLimitUnits);
		if (damage > cap) {
			throw appError(
				'CHARGE_TOO_HIGH',
				`Damage on a deposit-free container cannot exceed the access key's daily cap of ${formatUsd(cap)}.`
			);
		}
		const room = u(c.depositUnits) - pulled;
		if (damage > room) damage = room > 0n ? room : 0n;
	}
	const damagePull =
		damage > 0n && c.state === 'returned'
			? { amountUnits: damage.toString(), memo: cMemo, memoHex: encodeMemo(cMemo) }
			: undefined;
	await ctx.db.patch(c._id, {
		state: 'settling',
		stateChangedAt: a.now,
		damageUnits: damage.toString(),
		chargeNote: a.note ?? c.chargeNote,
		chargesPostedAt: c.chargesPostedAt ?? a.now,
		pendingOnChain: {
			step: settleStep(a.source),
			since: c.pendingOnChain?.step === settleStep(a.source) ? c.pendingOnChain.since : a.now,
			attempts: c.pendingOnChain?.step === settleStep(a.source) ? c.pendingOnChain.attempts + 1 : 1
		}
	});
	return {
		...base,
		chargeUnits: (pulled + damage).toString(),
		damageUnits: damage.toString(),
		disputedUnits: '0',
		refundUnits: '0',
		heldUnits: '0',
		cappedByDeposit: accruedUnits + damageRaw > u(c.depositUnits),
		items: [],
		depositFree: {
			keyId: key._id,
			account: key.account,
			keyAddress: key.keyAddress,
			encPrivKey: key.encPrivKey,
			to: chargesAddress || key.recipient,
			pulledUnits: pulled.toString(),
			damagePull
		}
	};
}

async function resolverFor(
	ctx: MutationCtx,
	c: Doc<'containers'>
): Promise<Id<'organizations'> | undefined> {
	const rel = await ctx.db
		.query('relationships')
		.withIndex('by_pair', (q) =>
			q.eq('lineOrgId', c.lineOrgId).eq('importerOrgId', c.importerOrgId)
		)
		.unique();
	if (rel) return rel.resolverOrgId;
	const line = await ctx.db.get(c.lineOrgId);
	return line?.resolverOrgId ?? c.lineOrgId;
}

export interface FinishInfo {
	tx: TxResultJson;
	legs: SimLeg[];
	now: number;
	actor: string;
}

/** Held mode: the settlement transaction is final. Record payments and close (or hold for dispute). */
export async function finishHeldSettlementOp(
	ctx: MutationCtx,
	plan: SettlementPlan,
	f: FinishInfo
): Promise<Doc<'containers'>> {
	const c = await ctx.db.get(plan.containerId);
	if (!c) throw appError('NOT_FOUND', 'Container not found.');
	if (c.state === 'settled' || c.state === 'disputed') return c; // idempotent
	const at = f.tx.timestamp;
	const legFor = (receiptId: string, kind: SimLeg['kind']) =>
		f.legs.find((l) => l.receiptId === receiptId && l.kind === kind);
	let refundTotal = 0n;
	let chargeTotal = 0n;
	for (const item of plan.items) {
		const charge = u(item.chargeUnits);
		const refund = u(item.refundUnits);
		const common = {
			mode: f.tx.mode,
			containerId: c._id,
			requestId: c.requestId,
			lineOrgId: c.lineOrgId,
			importerOrgId: c.importerOrgId,
			from: plan.settlementContract,
			token: (await receiptToken(ctx, c, item.receiptId)) ?? '',
			txHash: f.tx.txHash,
			blockNumber: f.tx.blockNumber,
			finalityMs: f.tx.finalityMs,
			timestamp: at,
			status: 'confirmed' as const,
			receiptId: item.receiptId,
			receipt: item.receipt
		};
		if (charge > 0n) {
			chargeTotal += charge;
			await ctx.db.insert('payments', {
				...common,
				kind: 'charge',
				to: plan.chargesAddress,
				amountUnits: item.chargeUnits,
				memo: item.chargeMemo,
				memoHex: item.chargeMemoHex,
				logIndex: legFor(item.receiptId, 'charge')?.logIndex
			});
		}
		if (refund > 0n) {
			refundTotal += refund;
			await ctx.db.insert('payments', {
				...common,
				kind: 'refund',
				to: item.originator,
				amountUnits: item.refundUnits,
				memo: item.refundMemo,
				memoHex: item.refundMemoHex,
				logIndex: legFor(item.receiptId, 'refund')?.logIndex
			});
		}
	}
	const disputed = u(plan.disputedUnits);
	const settled = disputed === 0n;
	const sinceReturn = c.returnedAt !== undefined ? at - c.returnedAt : 0;
	const next = await setState(ctx, c, settled ? 'settled' : 'disputed', at, {
		chargesUnits: plan.chargeUnits,
		damageUnits: plan.damageUnits,
		refundUnits: refundTotal.toString(),
		settledAt: settled ? at : undefined,
		pendingOnChain: undefined,
		scheduledJobId: undefined,
		accruedUnits: plan.accruedUnits,
		detentionDays: plan.detentionDays
	});
	if (c.scheduledJobId) {
		try {
			await ctx.scheduler.cancel(c.scheduledJobId as Id<'_scheduled_functions'>);
		} catch {
			// already ran
		}
	}
	const chargeText = chargeTotal > 0n ? `${formatUsd(chargeTotal)} to the line` : 'no charges';
	await logEvent(
		ctx,
		c._id,
		settled ? 'settled' : 'settled_disputed',
		settled ? 'Settled' : 'Settled, disputed amount held',
		at,
		`${chargeText}; ${formatUsd(refundTotal)} refunded to the importer${
			settled ? '' : `; ${formatUsd(disputed)} stays in escrow with the settlement contract`
		}. ${f.tx.finalityMs ? `Final in ${(f.tx.finalityMs / 1000).toFixed(1)} s.` : ''}`,
		f.actor
	);
	await notify(ctx, {
		orgId: c.importerOrgId,
		kind: 'refunded',
		title: `Refunded ${formatUsd(refundTotal)}: ${c.number}`,
		body:
			sinceReturn > 0
				? `${chargeText} was settled; ${formatUsd(refundTotal)} is back in your account ${formatDuration(sinceReturn)} after the return.`
				: `${chargeText} was settled; ${formatUsd(refundTotal)} is back in your account.`,
		containerId: c._id,
		at: f.now
	});
	await notify(ctx, {
		orgId: c.lineOrgId,
		kind: 'settled',
		title: `Settled: ${c.number}`,
		body: `${formatUsd(chargeTotal)} charges received${settled ? '' : `; ${formatUsd(disputed)} held for the dispute`}.`,
		containerId: c._id,
		at: f.now
	});
	if (settled) await updateTrackRecord(ctx, next, plan);
	await refreshRequestStatus(ctx, c.requestId);
	return next;
}

async function receiptToken(
	ctx: MutationCtx,
	c: Doc<'containers'>,
	receiptId: string
): Promise<string | undefined> {
	const p = (
		await ctx.db
			.query('payments')
			.withIndex('by_container', (q) => q.eq('containerId', c._id))
			.collect()
	).find((x) => x.receiptId === receiptId && x.kind === 'deposit');
	return p?.token;
}

async function updateTrackRecord(
	ctx: MutationCtx,
	c: Doc<'containers'>,
	plan: SettlementPlan
): Promise<void> {
	const rel = await ctx.db
		.query('relationships')
		.withIndex('by_pair', (q) =>
			q.eq('lineOrgId', c.lineOrgId).eq('importerOrgId', c.importerOrgId)
		)
		.unique();
	if (!rel) return;
	const clean =
		isCleanReturn({ detentionDays: plan.detentionDays, disputed: false }) &&
		u(plan.damageUnits) === 0n;
	await ctx.db.patch(
		rel._id,
		clean ? { cleanReturns: rel.cleanReturns + 1 } : { lateReturns: rel.lateReturns + 1 }
	);
}

export interface DepositFreeFinish {
	now: number;
	actor: string;
	damageTx?: TxResultJson;
	revokeTx: TxResultJson | null;
	/** Live: the importer still has to revoke with their passkey. */
	revokePending: boolean;
}

/** Deposit-free: detention was collected daily; close the container and the key. */
export async function finishDepositFreeSettlementOp(
	ctx: MutationCtx,
	plan: SettlementPlan,
	f: DepositFreeFinish
): Promise<Doc<'containers'>> {
	const c = await ctx.db.get(plan.containerId);
	if (!c) throw appError('NOT_FOUND', 'Container not found.');
	if (c.state === 'settled') return c;
	const df = plan.depositFree!;
	let damage = 0n;
	if (f.damageTx && df.damagePull) {
		damage = u(df.damagePull.amountUnits);
		await ctx.db.insert('payments', {
			kind: 'charge',
			mode: f.damageTx.mode,
			containerId: c._id,
			requestId: c.requestId,
			lineOrgId: c.lineOrgId,
			importerOrgId: c.importerOrgId,
			from: df.account,
			to: df.to,
			token: (await ctx.db.get(df.keyId))?.token ?? '',
			amountUnits: df.damagePull.amountUnits,
			memo: df.damagePull.memo,
			memoHex: df.damagePull.memoHex,
			txHash: f.damageTx.txHash,
			blockNumber: f.damageTx.blockNumber,
			finalityMs: f.damageTx.finalityMs,
			timestamp: f.damageTx.timestamp,
			status: 'confirmed'
		});
	}
	const at = Math.max(f.now, f.damageTx?.timestamp ?? 0, f.revokeTx?.timestamp ?? 0);
	const total = u(c.pulledUnits) + damage;
	const next = await setState(ctx, c, 'settled', at, {
		chargesUnits: total.toString(),
		damageUnits: damage.toString(),
		refundUnits: '0',
		settledAt: at,
		pendingOnChain: undefined,
		scheduledJobId: undefined,
		accruedUnits: plan.accruedUnits,
		detentionDays: plan.detentionDays
	});
	if (c.scheduledJobId) {
		try {
			await ctx.scheduler.cancel(c.scheduledJobId as Id<'_scheduled_functions'>);
		} catch {
			// already ran
		}
	}
	const shortfall = u(plan.accruedUnits) - u(c.pulledUnits);
	await logEvent(
		ctx,
		c._id,
		'settled',
		'Settled',
		at,
		`${formatUsd(total)} collected through the access key${
			shortfall > 0n ? `; ${formatUsd(shortfall)} of accrued detention could not be collected` : ''
		}. Nothing was held, so there is nothing to refund.`,
		f.actor
	);
	await notify(ctx, {
		orgId: c.importerOrgId,
		kind: 'settled',
		title: `Settled: ${c.number}`,
		body: `${formatUsd(total)} was collected through your access key in total. ${
			f.revokePending ? 'Revoke the access key to close it.' : 'The key is revoked.'
		}`,
		containerId: c._id,
		at: f.now
	});
	await notify(ctx, {
		orgId: c.lineOrgId,
		kind: 'settled',
		title: `Settled: ${c.number}`,
		body: `${formatUsd(total)} collected through the access key.`,
		containerId: c._id,
		at: f.now
	});
	const rel = await ctx.db
		.query('relationships')
		.withIndex('by_pair', (q) =>
			q.eq('lineOrgId', c.lineOrgId).eq('importerOrgId', c.importerOrgId)
		)
		.unique();
	if (rel) {
		const clean = plan.detentionDays === 0 && damage === 0n;
		await ctx.db.patch(
			rel._id,
			clean ? { cleanReturns: rel.cleanReturns + 1 } : { lateReturns: rel.lateReturns + 1 }
		);
	}
	// Key bookkeeping (the payment row for the revocation is written by recordKeyRevokedOp).
	if (f.revokePending) {
		await ctx.db.patch(df.keyId, { revokeRequestedAt: f.now });
		await notify(ctx, {
			orgId: c.importerOrgId,
			kind: 'revoke_key',
			title: `Revoke access key: ${c.number}`,
			body: 'Settlement is done. Approve the revocation with your passkey so the line can never pull again.',
			containerId: c._id,
			at: f.now
		});
	}
	await refreshRequestStatus(ctx, c.requestId);
	return next;
}

/** The chain step failed: roll back so the sweep or the user can retry. */
export async function failSettlementOp(
	ctx: MutationCtx,
	plan: SettlementPlan,
	error: ChainErr | string,
	now: number
): Promise<void> {
	const c = await ctx.db.get(plan.containerId);
	if (!c || c.state !== 'settling') return;
	const message = typeof error === 'string' ? error : error.message;
	const prev = c.pendingOnChain;
	await setState(ctx, c, 'returned', now, {
		pendingOnChain: {
			step: settleStep(plan.source),
			since: prev?.since ?? now,
			attempts: prev?.attempts ?? 1,
			lastError: message
		},
		disputeId: plan.disputeId ? undefined : c.disputeId
	});
	if (plan.disputeId) await ctx.db.delete(plan.disputeId);
	await logEvent(
		ctx,
		c._id,
		'settle_failed',
		'Settlement is pending on-chain',
		now,
		`${message} It will be retried automatically.`
	);
}

// ---------------------------------------------------------------------------
// Dispute resolution
// ---------------------------------------------------------------------------

export interface ResolvePlan {
	disputeId: Id<'disputes'>;
	containerId: Id<'containers'>;
	number: string;
	eir: string;
	lineOrgId: Id<'organizations'>;
	importerOrgId: Id<'organizations'>;
	toLineUnits: string;
	toImporterUnits: string;
	chargesAddress: string;
	settlementContract: string;
	/** Per receipt: how much of the escrow goes to the line. */
	items: {
		receiptId: string;
		receipt: string;
		escrowUnits: string;
		toLineUnits: string;
		originator: string;
	}[];
	memo: string;
	memoHex: Hex;
}

export async function beginResolveOp(
	ctx: MutationCtx,
	a: { disputeId: Id<'disputes'>; toLineUnits: string; note: string; now: number }
): Promise<ResolvePlan> {
	const d = await ctx.db.get(a.disputeId);
	if (!d) throw appError('NOT_FOUND', 'Dispute not found.');
	if (d.status !== 'open') throw appError('INVALID_STATE', 'This dispute is already resolved.');
	const c = await ctx.db.get(d.containerId);
	if (!c) throw appError('NOT_FOUND', 'Container not found.');
	const line = await ctx.db.get(c.lineOrgId);
	let split;
	try {
		split = disputeSplit({ disputedUnits: d.disputedUnits, toLineUnits: a.toLineUnits });
	} catch (e) {
		throw appError('INVALID', e instanceof Error ? e.message : 'Invalid split.');
	}
	const escrows = d.receiptEscrows ?? [];
	const lineAlloc = allocateCharge(
		escrows.map((e) => e.escrowUnits),
		split.toLine
	);
	const deposits = await ctx.db
		.query('payments')
		.withIndex('by_container', (q) => q.eq('containerId', c._id))
		.collect();
	const eir = c.returnReceipt?.eirNumber ?? '';
	const memo = disputeReleaseMemo(c.number, eir);
	return {
		disputeId: d._id,
		containerId: c._id,
		number: c.number,
		eir,
		lineOrgId: c.lineOrgId,
		importerOrgId: c.importerOrgId,
		toLineUnits: split.toLine.toString(),
		toImporterUnits: split.toImporter.toString(),
		chargesAddress: line?.chargesAddress ?? '',
		settlementContract: line?.settlementContract ?? line?.depositsAccount ?? '',
		items: escrows.map((e, i) => ({
			receiptId: e.receiptId,
			receipt: e.receipt,
			escrowUnits: e.escrowUnits,
			toLineUnits: lineAlloc[i].charge.toString(),
			originator: deposits.find((p) => p.receiptId === e.receiptId)?.from ?? ''
		})),
		memo,
		memoHex: encodeMemo(memo)
	};
}

export async function finishResolveOp(
	ctx: MutationCtx,
	plan: ResolvePlan,
	f: {
		txs: { receiptId: string; tx: TxResultJson; legs: SimLeg[] }[];
		now: number;
		decidedBy: Id<'users'>;
		note: string;
		actor: string;
	}
): Promise<void> {
	const d = await ctx.db.get(plan.disputeId);
	const c = await ctx.db.get(plan.containerId);
	if (!d || !c || d.status === 'resolved') return;
	let at = f.now;
	for (const it of plan.items) {
		const r = f.txs.find((t) => t.receiptId === it.receiptId);
		if (!r) continue;
		at = Math.max(at, r.tx.timestamp);
		const toLine = u(it.toLineUnits);
		const toImporter = u(it.escrowUnits) - toLine;
		const common = {
			mode: r.tx.mode,
			containerId: c._id,
			requestId: c.requestId,
			lineOrgId: c.lineOrgId,
			importerOrgId: c.importerOrgId,
			from: plan.settlementContract,
			token: (await receiptToken(ctx, c, it.receiptId)) ?? '',
			memo: plan.memo,
			memoHex: plan.memoHex,
			txHash: r.tx.txHash,
			blockNumber: r.tx.blockNumber,
			finalityMs: r.tx.finalityMs,
			timestamp: r.tx.timestamp,
			status: 'confirmed' as const,
			receiptId: it.receiptId,
			receipt: it.receipt
		};
		if (toLine > 0n) {
			await ctx.db.insert('payments', {
				...common,
				kind: 'dispute_release',
				to: plan.chargesAddress,
				amountUnits: toLine.toString(),
				logIndex: r.legs.find((l) => l.to === plan.chargesAddress.toLowerCase())?.logIndex
			});
		}
		if (toImporter > 0n) {
			await ctx.db.insert('payments', {
				...common,
				kind: 'dispute_release',
				to: it.originator,
				amountUnits: toImporter.toString(),
				logIndex: r.legs.find((l) => l.to === it.originator.toLowerCase())?.logIndex
			});
		}
	}
	await ctx.db.patch(d._id, {
		status: 'resolved',
		decision: {
			toLineUnits: plan.toLineUnits,
			toImporterUnits: plan.toImporterUnits,
			note: f.note,
			decidedAt: at,
			decidedBy: f.decidedBy
		}
	});
	const charges = u(c.chargesUnits ?? '0') - u(d.disputedUnits) + u(plan.toLineUnits);
	const refund = u(c.refundUnits ?? '0') + u(plan.toImporterUnits);
	await setState(ctx, c, 'settled', at, {
		chargesUnits: charges.toString(),
		refundUnits: refund.toString(),
		settledAt: at
	});
	await logEvent(
		ctx,
		c._id,
		'dispute_resolved',
		'Dispute resolved',
		at,
		`${formatUsd(u(plan.toLineUnits))} to the line, ${formatUsd(u(plan.toImporterUnits))} back to the importer. ${f.note}`,
		f.actor
	);
	for (const orgId of [c.importerOrgId, c.lineOrgId]) {
		await notify(ctx, {
			orgId,
			kind: 'dispute_resolved',
			title: `Dispute resolved: ${c.number}`,
			body: `${formatUsd(u(plan.toLineUnits))} goes to the line and ${formatUsd(u(plan.toImporterUnits))} to the importer.`,
			containerId: c._id,
			at: f.now
		});
	}
	const rel = await ctx.db
		.query('relationships')
		.withIndex('by_pair', (q) =>
			q.eq('lineOrgId', c.lineOrgId).eq('importerOrgId', c.importerOrgId)
		)
		.unique();
	if (rel) await ctx.db.patch(rel._id, { lateReturns: rel.lateReturns + 1 });
	await refreshRequestStatus(ctx, c.requestId);
}

// ---------------------------------------------------------------------------
// Held transfers
// ---------------------------------------------------------------------------

export interface HeldReturnPlan {
	heldTransferId: Id<'heldTransfers'>;
	receiptId: string;
	receipt: string;
	token: string;
	amountUnits: string;
	originator: string;
	lineOrgId: Id<'organizations'>;
	memo: string;
	memoHex: Hex;
}

export async function finishHeldReturnOp(
	ctx: MutationCtx,
	plan: HeldReturnPlan,
	f: { tx: TxResultJson; legs: SimLeg[]; now: number }
): Promise<void> {
	const h = await ctx.db.get(plan.heldTransferId);
	if (!h || h.status !== 'held') return;
	await ctx.db.patch(h._id, {
		status: 'returned',
		returnedTxHash: f.tx.txHash,
		returnedAt: f.tx.timestamp
	});
	await ctx.db.insert('payments', {
		kind: 'held_return',
		mode: f.tx.mode,
		containerId: h.containerId,
		lineOrgId: h.lineOrgId,
		from: '',
		to: plan.originator,
		token: plan.token,
		amountUnits: plan.amountUnits,
		memo: plan.memo,
		memoHex: plan.memoHex,
		txHash: f.tx.txHash,
		logIndex: f.legs[0]?.logIndex,
		blockNumber: f.tx.blockNumber,
		finalityMs: f.tx.finalityMs,
		timestamp: f.tx.timestamp,
		status: 'confirmed',
		receiptId: plan.receiptId,
		receipt: plan.receipt
	});
	await notify(ctx, {
		orgId: h.lineOrgId,
		kind: 'held_returned',
		title: 'Held transfer returned',
		body: `${formatUsd(u(plan.amountUnits))} ${h.tokenSymbol} went back to the sender through the settlement contract.`,
		at: f.now
	});
}

export function heldReturnMemoPair(receiptId: string): { memo: string; memoHex: Hex } {
	const memo = heldReturnMemoText(receiptId);
	return { memo, memoHex: encodeMemo(memo) };
}

function formatDuration(ms: number): string {
	const s = Math.max(0, Math.round(ms / 1000));
	if (s < 90) return `${s} seconds`;
	const m = Math.round(s / 60);
	if (m < 90) return `${m} minutes`;
	const h = Math.round(m / 60);
	if (h < 48) return `${h} hours`;
	return `${Math.round(h / 24)} days`;
}

export { minBig };
