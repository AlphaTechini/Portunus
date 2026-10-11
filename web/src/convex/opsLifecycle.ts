/**
 * Plain mutation-context operations for the container lifecycle: release, scheduling, daily
 * detention (held accrual and deposit-free pulls), and recording the empty's return.
 * Every function takes the product time `now` explicitly (ARCHITECTURE section 3).
 */
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { appError, clockOffset, logEvent, notify, schedulerTime, setState } from './helpers';
import { refreshRequestStatus } from './opsRequests';
import {
	accrued,
	detentionDayDueAt,
	detentionDaysAt,
	freeTimeEndsAt as computeFreeTimeEnd,
	settlementWindowEnd,
	silentLineEligible
} from '../lib/shared/domain/rules';
import { DAY_MS, DEFAULT_SETTLEMENT_WINDOW_DAYS } from '../lib/shared/domain/constants';
import { pullMemo, type Hex, encodeMemo } from '../lib/shared/domain/memo';
import { formatUsd, minBig, u } from '../lib/shared/domain/money';
import type { ChainErr } from './chain';
import type { TxResultJson } from '../lib/shared/tempo/adapter';

const fmtDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Scheduling (details 14.3). One tracked job per container; the daily sweep is the backstop.
// ---------------------------------------------------------------------------

export async function scheduleNextJob(
	ctx: MutationCtx,
	containerId: Id<'containers'>,
	now: number
): Promise<void> {
	const c = await ctx.db.get(containerId);
	if (!c) return;
	if (c.scheduledJobId) {
		try {
			await ctx.scheduler.cancel(c.scheduledJobId as Id<'_scheduled_functions'>);
		} catch {
			// already ran or gone
		}
	}
	const offset = await clockOffset(ctx);
	// A step that keeps failing (RPC down, refused pull) must not re-run in a tight loop: back off.
	const attempts = c.pendingOnChain?.attempts ?? 0;
	const when = (target: number): number => {
		const at = schedulerTime(target, offset);
		if (attempts === 0) return at;
		return Math.max(at, Date.now() + Math.min(attempts * 5 * 60_000, 6 * 3_600_000));
	};
	let jobId: Id<'_scheduled_functions'> | undefined;
	if ((c.state === 'released' || c.state === 'in_free_time') && c.freeTimeEndsAt !== undefined) {
		jobId = await ctx.scheduler.runAt(when(c.freeTimeEndsAt), internal.lifecycle.onFreeTimeEnd, {
			containerId
		});
	} else if (
		c.state === 'in_detention' &&
		c.returnedAt === undefined &&
		c.freeTimeEndsAt !== undefined
	) {
		if (c.detentionDays < c.maxDetentionDays) {
			const due = detentionDayDueAt(c.freeTimeEndsAt, c.detentionDays + 1);
			jobId = await ctx.scheduler.runAt(when(due), internal.lifecycle.dailyDetention, {
				containerId
			});
		}
	} else if (c.state === 'returned' && c.settlementWindowEndsAt !== undefined) {
		jobId = await ctx.scheduler.runAt(
			when(c.settlementWindowEndsAt),
			internal.lifecycle.onWindowEnd,
			{
				containerId
			}
		);
	}
	await ctx.db.patch(containerId, { scheduledJobId: jobId ? String(jobId) : undefined });
	void now;
}

// ---------------------------------------------------------------------------
// Release order
// ---------------------------------------------------------------------------

export interface ReleaseResult {
	released: Id<'containers'>[];
	blocked: {
		containerId: Id<'containers'>;
		number: string;
		reason: string;
		missingUnits?: string;
	}[];
}

export async function releaseRequestContainers(
	ctx: MutationCtx,
	requestId: Id<'releaseRequests'>,
	now: number,
	actor: string,
	opts: { schedule?: boolean } = {}
): Promise<ReleaseResult> {
	const containers = await ctx.db
		.query('containers')
		.withIndex('by_request', (q) => q.eq('requestId', requestId))
		.collect();
	const request = await ctx.db.get(requestId);
	const result: ReleaseResult = { released: [], blocked: [] };
	for (const c of containers) {
		if (c.state === 'deposit_held' || c.state === 'authorized') {
			const cur = await setState(ctx, c, 'released', now, { releasedAt: now });
			const end = computeFreeTimeEnd(now, c.freeDays);
			await setState(ctx, cur, 'in_free_time', now, { freeTimeEndsAt: end });
			await logEvent(
				ctx,
				c._id,
				'released',
				'Release order issued',
				now,
				`Issued by ${actor}.`,
				actor
			);
			await logEvent(
				ctx,
				c._id,
				'in_free_time',
				'Free time started',
				now,
				`${c.freeDays} free days, ending ${fmtDate(end)}. Detention is ${formatUsd(u(c.dailyRateUnits))} per day after that.`
			);
			if (opts.schedule !== false) {
				await scheduleNextJob(ctx, c._id, now);
				if (c.mode === 'depositFree') await scheduleKeyExpiryWarning(ctx, c._id);
			}
			await notify(ctx, {
				orgId: c.importerOrgId,
				kind: 'released',
				title: `Released: ${c.number}`,
				body: `Free time ends ${fmtDate(end)}. Return the empty before then to avoid ${formatUsd(u(c.dailyRateUnits))} per day.`,
				containerId: c._id,
				at: now
			});
			result.released.push(c._id);
		} else if (c.state === 'awaiting_deposit') {
			const missing = u(c.depositUnits) - u(c.receivedUnits ?? '0');
			result.blocked.push({
				containerId: c._id,
				number: c.number,
				reason: `Deposit incomplete: ${formatUsd(missing)} still missing.`,
				missingUnits: missing.toString()
			});
		} else if (c.state === 'requested') {
			result.blocked.push({
				containerId: c._id,
				number: c.number,
				reason: 'Waiting for the importer to authorize the access key.'
			});
		}
	}
	void request;
	await refreshRequestStatus(ctx, requestId);
	return result;
}

export async function scheduleKeyExpiryWarning(
	ctx: MutationCtx,
	containerId: Id<'containers'>
): Promise<void> {
	const key = await ctx.db
		.query('accessKeys')
		.withIndex('by_container', (q) => q.eq('containerId', containerId))
		.first();
	if (!key || key.status !== 'active') return;
	const offset = await clockOffset(ctx);
	await ctx.scheduler.runAt(
		schedulerTime(key.expiry - DAY_MS, offset),
		internal.lifecycle.keyExpiryWarning,
		{ containerId }
	);
}

// ---------------------------------------------------------------------------
// Detention: held accrual and deposit-free pulls
// ---------------------------------------------------------------------------

export type DetentionStep =
	| { kind: 'done' }
	| {
			kind: 'pull';
			day: number;
			dueAt: number;
			amountUnits: string;
			account: string;
			keyAddress: string;
			encPrivKey: string;
			to: string;
			memoHex: Hex;
			memo: string;
	  };

/**
 * Advance a container's detention as far as the product clock allows without touching the chain.
 * Held containers accrue every due day in one go. Deposit-free containers stop at the first day
 * that needs an access-key pull and return it for the action to execute.
 * Idempotent: `detentionDays` is the count of days already processed.
 */
export async function detentionStepOp(
	ctx: MutationCtx,
	containerId: Id<'containers'>,
	now: number
): Promise<DetentionStep> {
	let c = await ctx.db.get(containerId);
	if (!c || c.freeTimeEndsAt === undefined) return { kind: 'done' };
	const freeEnd: number = c.freeTimeEndsAt;
	const live: Doc<'containers'>['state'][] = [
		'released',
		'in_free_time',
		'in_detention',
		'returned'
	];
	if (!live.includes(c.state)) return { kind: 'done' };
	// Held containers have their accrual settled by the rules at return time.
	if (c.state === 'returned' && c.mode === 'held') return { kind: 'done' };

	if (c.state === 'released') c = await setState(ctx, c, 'in_free_time', now);
	if (c.state === 'in_free_time' && now >= freeEnd) {
		c = await setState(ctx, c, 'in_detention', freeEnd);
		await logEvent(
			ctx,
			c._id,
			'in_detention',
			'Free time ended, detention started',
			freeEnd,
			`${formatUsd(u(c.dailyRateUnits))} per day, capped at ${formatUsd(u(c.depositUnits))}.`
		);
		await notify(ctx, {
			orgId: c.importerOrgId,
			kind: 'detention_started',
			title: `Detention started: ${c.number}`,
			body: `Free time ended. Detention runs at ${formatUsd(u(c.dailyRateUnits))} per day until the empty is returned.`,
			containerId: c._id,
			at: freeEnd
		});
		await notify(ctx, {
			orgId: c.lineOrgId,
			kind: 'detention_started',
			title: `Past free time: ${c.number}`,
			body: `Detention is now accruing at ${formatUsd(u(c.dailyRateUnits))} per day.`,
			containerId: c._id,
			at: freeEnd
		});
	}
	if (c.state !== 'in_detention' && c.state !== 'returned') return { kind: 'done' };

	const due = detentionDaysAt(
		{ freeTimeEndsAt: freeEnd, maxDetentionDays: c.maxDetentionDays, returnedAt: c.returnedAt },
		now
	);
	const rate = u(c.dailyRateUnits);
	const deposit = u(c.depositUnits);
	let day = c.detentionDays;
	const pulled = u(c.pulledUnits);
	let accruedNow = u(c.accruedUnits);
	const request = await ctx.db.get(c.requestId);
	const line = await ctx.db.get(c.lineOrgId);
	const key =
		c.mode === 'depositFree'
			? await ctx.db
					.query('accessKeys')
					.withIndex('by_container', (q) => q.eq('containerId', containerId))
					.first()
			: null;

	while (day < due) {
		const next = day + 1;
		if (c.mode === 'depositFree' && key && key.status === 'active' && !key.unusableReason) {
			const amount = minBig(rate, deposit - pulled);
			if (amount > 0n) {
				const memo = pullMemo(c.number, next, request?.billOfLading ?? '');
				const prev = c.pendingOnChain;
				await ctx.db.patch(c._id, {
					detentionDays: day,
					accruedUnits: accruedNow.toString(),
					pendingOnChain: {
						step: `pull:${next}`,
						since: prev?.step === `pull:${next}` ? prev.since : now,
						attempts: prev?.step === `pull:${next}` ? prev.attempts + 1 : 1,
						lastError: prev?.step === `pull:${next}` ? prev.lastError : undefined
					}
				});
				return {
					kind: 'pull',
					day: next,
					dueAt: detentionDayDueAt(freeEnd, next),
					amountUnits: amount.toString(),
					account: key.account,
					keyAddress: key.keyAddress,
					encPrivKey: key.encPrivKey,
					to: line?.chargesAddress ?? key.recipient,
					memoHex: encodeMemo(memo),
					memo
				};
			}
		}
		// Held mode, an unusable key, or the deposit cap reached: accrue only.
		accruedNow = accrued({ days: next, dailyRateUnits: rate, depositUnits: deposit });
		day = next;
	}
	if (day !== c.detentionDays || c.pendingOnChain) {
		await ctx.db.patch(c._id, {
			detentionDays: day,
			accruedUnits: accruedNow.toString(),
			pendingOnChain: undefined
		});
	}
	return { kind: 'done' };
}

export interface PullOutcome {
	retry: boolean;
	advanced: boolean;
}

/** Record the result of an access-key pull attempt for one detention day. */
export async function pullResultOp(
	ctx: MutationCtx,
	a: {
		containerId: Id<'containers'>;
		day: number;
		amountUnits: string;
		memoHex: string;
		memo: string;
		account: string;
		to: string;
		result: { ok: true; tx: TxResultJson } | { ok: false; error: ChainErr };
		now: number;
		dueAt: number;
	}
): Promise<PullOutcome> {
	const c = await ctx.db.get(a.containerId);
	if (!c) return { retry: false, advanced: false };
	if (c.detentionDays >= a.day) return { retry: false, advanced: false }; // already processed: exactly once
	const rate = u(c.dailyRateUnits);
	const deposit = u(c.depositUnits);
	const accruedUnits = accrued({
		days: a.day,
		dailyRateUnits: rate,
		depositUnits: deposit
	}).toString();
	const key = c.accessKeyId ? await ctx.db.get(c.accessKeyId) : null;
	const base = {
		containerId: c._id,
		requestId: c.requestId,
		lineOrgId: c.lineOrgId,
		importerOrgId: c.importerOrgId,
		from: a.account,
		to: a.to,
		token: key?.token ?? '',
		amountUnits: a.amountUnits,
		memo: a.memo,
		memoHex: a.memoHex,
		day: a.day
	};
	if (a.result.ok) {
		const tx = a.result.tx;
		await ctx.db.insert('payments', {
			...base,
			kind: 'detention_pull',
			mode: tx.mode,
			txHash: tx.txHash,
			blockNumber: tx.blockNumber,
			finalityMs: tx.finalityMs,
			timestamp: tx.timestamp,
			status: 'confirmed'
		});
		const pulled = u(c.pulledUnits) + u(a.amountUnits);
		await ctx.db.patch(c._id, {
			detentionDays: a.day,
			pulledUnits: pulled.toString(),
			accruedUnits,
			pendingOnChain: undefined
		});
		await logEvent(
			ctx,
			c._id,
			'detention_pull',
			`Detention pulled for day ${a.day}`,
			tx.timestamp,
			`${formatUsd(u(a.amountUnits))} via the access key. ${a.memo}`
		);
		await notify(ctx, {
			orgId: c.importerOrgId,
			kind: 'detention_pull',
			title: `Detention day ${a.day}: ${c.number}`,
			body: `${formatUsd(u(a.amountUnits))} was pulled with your access key. The cap is one day's detention per day.`,
			containerId: c._id,
			at: a.now
		});
		return { retry: false, advanced: true };
	}
	const err = a.result.error;
	const failedRow = async () =>
		ctx.db.insert('payments', {
			...base,
			kind: 'detention_pull',
			mode: key?.mode ?? 'sim',
			txHash: '',
			finalityMs: 0,
			timestamp: a.now,
			status: 'failed',
			error:
				err.name === 'SpendingLimitExceeded'
					? 'SpendingLimitExceeded'
					: `${err.name}: ${err.message}`
		});
	const terminal = ['KeyAlreadyRevoked', 'KeyExpired', 'CallNotAllowed', 'KeyNotFound'];
	if (terminal.includes(err.name) || err.name === 'InsufficientBalance') {
		await failedRow();
		if (key && terminal.includes(err.name))
			await ctx.db.patch(key._id, { unusableReason: err.name });
		await ctx.db.patch(c._id, { detentionDays: a.day, accruedUnits, pendingOnChain: undefined });
		const why =
			err.name === 'KeyAlreadyRevoked'
				? 'The importer revoked the access key.'
				: err.name === 'KeyExpired'
					? 'The access key has expired.'
					: err.name === 'InsufficientBalance'
						? "The importer's account does not hold enough to cover the pull."
						: 'The chain refused the pull.';
		await logEvent(ctx, c._id, 'pull_failed', `Detention pull for day ${a.day} failed`, a.now, why);
		await notify(ctx, {
			orgId: c.lineOrgId,
			kind: 'pull_failed',
			title: `Pull failed: ${c.number}`,
			body: `${why} Day ${a.day} detention (${formatUsd(u(a.amountUnits))}) is uncollected and counts as exposure.`,
			containerId: c._id,
			at: a.now
		});
		return { retry: false, advanced: true };
	}
	// SpendingLimitExceeded on a scheduled pull, or an infrastructure error: keep the day open, retry later.
	if (err.name === 'SpendingLimitExceeded') await failedRow();
	const prev = c.pendingOnChain;
	await ctx.db.patch(c._id, {
		pendingOnChain: {
			step: `pull:${a.day}`,
			since: prev?.since ?? a.now,
			attempts: (prev?.attempts ?? 0) + (prev?.step === `pull:${a.day}` ? 0 : 1),
			lastError: err.message
		}
	});
	return { retry: true, advanced: false };
}

// ---------------------------------------------------------------------------
// Return of the empty
// ---------------------------------------------------------------------------

export interface ReturnInput {
	eirNumber: string;
	date: number;
	depot: string;
}

async function windowDaysFor(ctx: MutationCtx, lineOrgId: Id<'organizations'>): Promise<number> {
	const line = await ctx.db.get(lineOrgId);
	return line?.settlementWindowDays ?? DEFAULT_SETTLEMENT_WINDOW_DAYS;
}

export async function recordReturnOp(
	ctx: MutationCtx,
	containerId: Id<'containers'>,
	input: ReturnInput,
	by: 'line' | 'importer',
	now: number,
	actor: string,
	opts: { schedule?: boolean } = {}
): Promise<Doc<'containers'>> {
	const c0 = await ctx.db.get(containerId);
	if (!c0) throw appError('NOT_FOUND', 'Container not found.');
	if (c0.returnReceipt && c0.state !== 'returned')
		throw appError('INVALID_STATE', 'A return receipt is already recorded.');
	if (!['released', 'in_free_time', 'in_detention'].includes(c0.state)) {
		throw appError(
			'INVALID_STATE',
			`A return cannot be recorded while the container is "${c0.state.replace('_', ' ')}".`
		);
	}
	const eir = input.eirNumber.trim();
	if (!eir) throw appError('INVALID', 'Enter the return receipt (EIR) number.');
	if (!input.depot.trim()) throw appError('INVALID', 'Enter the depot.');
	if (!Number.isFinite(input.date)) throw appError('INVALID', 'Enter a valid return date.');
	if (input.date > now + 60_000)
		throw appError('INVALID', 'The return date cannot be in the future.');
	if (c0.releasedAt !== undefined && input.date < c0.releasedAt) {
		throw appError('INVALID', 'The return date is before the container was released.');
	}
	let returnedAt = Math.min(input.date, now);
	if (c0.mode === 'depositFree' && c0.freeTimeEndsAt !== undefined && c0.detentionDays > 0) {
		const lastPullStart = detentionDayDueAt(c0.freeTimeEndsAt, c0.detentionDays);
		// The return date is entered to the minute, so "now" can land a few seconds before the pull
		// that has just run. Within that minute, count the return from the pull.
		if (returnedAt < lastPullStart && lastPullStart - returnedAt < 60_000 && lastPullStart <= now)
			returnedAt = lastPullStart;
		if (returnedAt < lastPullStart) {
			throw appError(
				'INVALID',
				'The return date is earlier than a detention day that was already pulled.'
			);
		}
	}
	let c = c0;
	// Walk the state machine: released -> in_free_time first if needed.
	if (c.state === 'released') c = await setState(ctx, c, 'in_free_time', now);
	const windowDays = await windowDaysFor(ctx, c.lineOrgId);
	const windowStart = by === 'importer' ? now : returnedAt;
	const windowEnd = settlementWindowEnd(windowStart, windowDays);
	const days =
		c.freeTimeEndsAt === undefined
			? 0
			: detentionDaysAt(
					{ freeTimeEndsAt: c.freeTimeEndsAt, maxDetentionDays: c.maxDetentionDays, returnedAt },
					now
				);
	const patch: Partial<Doc<'containers'>> = {
		returnedAt,
		returnReceipt: {
			eirNumber: eir,
			date: returnedAt,
			depot: input.depot.trim(),
			submittedBy: by,
			recordedAt: now
		},
		settlementWindowEndsAt: windowEnd
	};
	if (c.mode === 'held') {
		patch.detentionDays = days;
		patch.accruedUnits = accrued({
			days,
			dailyRateUnits: c.dailyRateUnits,
			depositUnits: c.depositUnits
		}).toString();
	}
	c = await setState(ctx, c, 'returned', now, patch);
	const owed =
		days === 0
			? 'No detention is owed.'
			: `${days} detention day${days === 1 ? '' : 's'} at ${formatUsd(u(c.dailyRateUnits))}.`;
	await logEvent(
		ctx,
		c._id,
		by === 'importer' ? 'return_submitted' : 'returned',
		by === 'importer' ? 'Return receipt submitted by importer' : 'Empty returned',
		now,
		`EIR ${eir} at ${input.depot.trim()} on ${fmtDate(returnedAt)}. ${owed} Settlement window ends ${fmtDate(windowEnd)}.`,
		actor
	);
	if (opts.schedule !== false) await scheduleNextJob(ctx, c._id, now);
	if (by === 'importer') {
		await notify(ctx, {
			orgId: c.lineOrgId,
			kind: 'return_submitted',
			title: `Return submitted: ${c.number}`,
			body: `${actor} submitted EIR ${eir}. Contest it before ${fmtDate(windowEnd)} or the refund proceeds.`,
			containerId: c._id,
			at: now
		});
	} else {
		await notify(ctx, {
			orgId: c.importerOrgId,
			kind: 'returned',
			title: `Return recorded: ${c.number}`,
			body: `EIR ${eir}. ${owed} The refund settles by ${fmtDate(windowEnd)}.`,
			containerId: c._id,
			at: now
		});
	}
	return c;
}

/** Importer-side eligibility for the silent-line rule. */
export async function checkSilentLine(
	ctx: MutationCtx,
	c: Doc<'containers'>,
	input: ReturnInput,
	now: number
): Promise<void> {
	const line = await ctx.db.get(c.lineOrgId);
	const r = silentLineEligible({
		state: c.state,
		hasReturnReceipt: c.returnReceipt !== undefined,
		releasedAt: c.releasedAt,
		returnDate: input.date,
		now,
		graceHours: line?.silentGraceHours
	});
	if (!r.ok) throw appError('NOT_ELIGIBLE', r.reason);
}

/** The line contests an importer-submitted receipt inside the window: back to the previous state. */
export async function contestReturnOp(
	ctx: MutationCtx,
	c: Doc<'containers'>,
	note: string,
	now: number,
	actor: string
): Promise<void> {
	const receipt = c.returnReceipt;
	if (!receipt || receipt.submittedBy !== 'importer') {
		throw appError(
			'INVALID_STATE',
			'Only a return receipt submitted by the importer can be contested.'
		);
	}
	if (c.state !== 'returned')
		throw appError('INVALID_STATE', 'This return can no longer be contested.');
	if (c.settlementWindowEndsAt !== undefined && now >= c.settlementWindowEndsAt) {
		throw appError('WINDOW_CLOSED', 'The window to contest this receipt has closed.');
	}
	const back =
		c.freeTimeEndsAt !== undefined && now >= c.freeTimeEndsAt
			? ('in_detention' as const)
			: ('in_free_time' as const);
	const days =
		c.freeTimeEndsAt === undefined
			? 0
			: detentionDaysAt(
					{ freeTimeEndsAt: c.freeTimeEndsAt, maxDetentionDays: c.maxDetentionDays },
					now
				);
	await setState(ctx, c, back, now, {
		returnedAt: undefined,
		returnReceipt: undefined,
		settlementWindowEndsAt: undefined,
		detentionDays: c.mode === 'held' ? days : c.detentionDays,
		accruedUnits:
			c.mode === 'held'
				? accrued({
						days,
						dailyRateUnits: c.dailyRateUnits,
						depositUnits: c.depositUnits
					}).toString()
				: c.accruedUnits
	});
	await logEvent(
		ctx,
		c._id,
		'return_contested',
		'Return receipt contested by the line',
		now,
		note || undefined,
		actor
	);
	await notify(ctx, {
		orgId: c.importerOrgId,
		kind: 'return_contested',
		title: `Return contested: ${c.number}`,
		body: note
			? `The line contests EIR ${receipt.eirNumber}: ${note}`
			: `The line contests EIR ${receipt.eirNumber}.`,
		containerId: c._id,
		at: now
	});
	await scheduleNextJob(ctx, c._id, now);
}
