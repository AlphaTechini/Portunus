/**
 * Pure settlement rules (details.md section 9, ARCHITECTURE section 5).
 * No I/O. Everything takes explicit timestamps (the "product now").
 */
import {
	DAY_MS,
	DEFAULT_MAX_DETENTION_DAYS,
	DEFAULT_SETTLEMENT_WINDOW_DAYS,
	DEFAULT_SILENT_GRACE_HOURS,
	HOUR_MS
} from './constants';
import { maxBig, minBig, u, type UnitsLike } from './money';
import type { ContainerState } from './states';

export type DepositMode = 'held' | 'depositFree';

export function freeTimeEndsAt(releasedAt: number, freeDays: number): number {
	return releasedAt + freeDays * DAY_MS;
}

export interface DetentionClock {
	freeTimeEndsAt: number;
	maxDetentionDays?: number;
	returnedAt?: number;
}

/**
 * Detention is charged per STARTED day after free time ends. At the instant free
 * time ends, day 1 starts. Counting stops at the return time and at maxDetentionDays.
 */
export function detentionDaysAt(c: DetentionClock, now: number): number {
	const end = Math.min(now, c.returnedAt ?? Number.POSITIVE_INFINITY);
	if (end <= c.freeTimeEndsAt) return 0;
	const days = Math.floor((end - c.freeTimeEndsAt) / DAY_MS) + 1;
	return Math.min(days, c.maxDetentionDays ?? DEFAULT_MAX_DETENTION_DAYS);
}

/** Product time at which detention day `day` (1-based) starts and its pull is due. */
export function detentionDayDueAt(freeTimeEnd: number, day: number): number {
	return freeTimeEnd + (day - 1) * DAY_MS;
}

/** Accrued detention against the deposit: days x daily rate, capped at the deposit. */
export function accrued(args: {
	days: number;
	dailyRateUnits: UnitsLike;
	depositUnits: UnitsLike;
}): bigint {
	return minBig(BigInt(Math.max(0, args.days)) * u(args.dailyRateUnits), u(args.depositUnits));
}

/** Accrued detention at `now` for a container's terms. */
export function accruedAt(
	c: DetentionClock & { dailyRateUnits: UnitsLike; depositUnits: UnitsLike },
	now: number
): bigint {
	return accrued({
		days: detentionDaysAt(c, now),
		dailyRateUnits: c.dailyRateUnits,
		depositUnits: c.depositUnits
	});
}

/** Final charges can never exceed the deposit, nor accrued detention plus the stated damage. */
export function maxCharge(args: {
	depositUnits: UnitsLike;
	accruedUnits: UnitsLike;
	damageUnits?: UnitsLike;
}): bigint {
	return minBig(u(args.depositUnits), u(args.accruedUnits) + u(args.damageUnits ?? 0));
}

export interface SettlementAmounts {
	/** Total final charge owed to the line (disputed part included). */
	chargeUnits: bigint;
	/** The part of the charge paid to the line immediately. */
	toLineNowUnits: bigint;
	/** The disputed part, kept in escrow by the settlement contract. */
	escrowUnits: bigint;
	/** Back to the importer now: held - charge (includes any overpayment). */
	refundUnits: bigint;
	/** Amount held above the required deposit. */
	overpaymentUnits: bigint;
}

/**
 * refund = held - charge, charge <= min(deposit, accrued + damage, held).
 * With a dispute, the disputed part of the charge is withheld from the line and
 * from the refund until the resolver decides.
 */
export function settlementAmounts(args: {
	heldUnits: UnitsLike;
	depositUnits: UnitsLike;
	accruedUnits: UnitsLike;
	damageUnits?: UnitsLike;
	disputedUnits?: UnitsLike;
}): SettlementAmounts {
	const held = u(args.heldUnits);
	const deposit = u(args.depositUnits);
	const disputed = u(args.disputedUnits ?? 0);
	const charge = minBig(maxCharge(args), held);
	if (disputed < 0n || disputed > charge)
		throw new Error('Disputed amount must be between 0 and the charge');
	return {
		chargeUnits: charge,
		toLineNowUnits: charge - disputed,
		escrowUnits: disputed,
		refundUnits: held - charge,
		overpaymentUnits: maxBig(0n, held - deposit)
	};
}

/**
 * Spread one container-level charge over the deposit receipts that back it
 * (a container can be funded by several transfers). Earlier receipts pay first.
 */
export function allocateCharge(
	receiptAmounts: UnitsLike[],
	chargeUnits: UnitsLike,
	disputedUnits: UnitsLike = 0n
): { charge: bigint; disputed: bigint; refund: bigint }[] {
	let chargeLeft = u(chargeUnits);
	let disputedLeft = u(disputedUnits);
	return receiptAmounts.map((a) => {
		const amount = u(a);
		const charge = minBig(chargeLeft, amount);
		chargeLeft -= charge;
		const disputed = minBig(disputedLeft, charge);
		disputedLeft -= disputed;
		return { charge, disputed, refund: amount - charge };
	});
}

/** Dispute outcome: the resolver splits the escrow between line and importer. */
export function disputeSplit(args: { disputedUnits: UnitsLike; toLineUnits: UnitsLike }): {
	toLine: bigint;
	toImporter: bigint;
} {
	const disputed = u(args.disputedUnits);
	const toLine = u(args.toLineUnits);
	if (toLine < 0n || toLine > disputed)
		throw new Error('Resolver amount must be between 0 and the disputed amount');
	return { toLine, toImporter: disputed - toLine };
}

export function settlementWindowEnd(
	returnedAt: number,
	windowDays = DEFAULT_SETTLEMENT_WINDOW_DAYS
): number {
	return returnedAt + windowDays * DAY_MS;
}

/** Deposit-free access key expiry: end of free time plus the maximum detention days. */
export function depositFreeExpiry(
	freeTimeEnd: number,
	maxDetentionDays = DEFAULT_MAX_DETENTION_DAYS
): number {
	return freeTimeEnd + maxDetentionDays * DAY_MS;
}

/**
 * The silent-line rule: if the line never records a return, the importer may
 * submit the receipt after the line has had a grace period since the empty's return date.
 */
export function silentLineEligible(args: {
	state: ContainerState;
	hasReturnReceipt: boolean;
	releasedAt?: number;
	returnDate: number;
	now: number;
	graceHours?: number;
}): { ok: true } | { ok: false; reason: string } {
	if (args.hasReturnReceipt) return { ok: false, reason: 'A return receipt is already recorded.' };
	if (args.state !== 'released' && args.state !== 'in_free_time' && args.state !== 'in_detention') {
		return { ok: false, reason: 'This container is not out for delivery.' };
	}
	if (args.releasedAt !== undefined && args.returnDate < args.releasedAt) {
		return { ok: false, reason: 'The return date is before the container was released.' };
	}
	if (args.returnDate > args.now) return { ok: false, reason: 'The return date is in the future.' };
	const grace = (args.graceHours ?? DEFAULT_SILENT_GRACE_HOURS) * HOUR_MS;
	if (args.now - args.returnDate < grace) {
		return { ok: false, reason: 'The line still has time to record this return itself.' };
	}
	return { ok: true };
}

/** Suggest deposit-free once the importer has enough clean returns and nothing open. */
export function suggestedMode(args: {
	cleanReturns: number;
	openDisputes: number;
	cleanReturnsForDepositFree?: number;
}): DepositMode {
	const threshold = args.cleanReturnsForDepositFree ?? 3;
	return args.cleanReturns >= threshold && args.openDisputes <= 0 ? 'depositFree' : 'held';
}

/** Is a return "clean"? On time or within free time, and not disputed. */
export function isCleanReturn(args: { detentionDays: number; disputed: boolean }): boolean {
	return args.detentionDays === 0 && !args.disputed;
}

/** Milliseconds left in free time (never negative). */
export function freeTimeRemainingMs(freeTimeEnd: number, now: number): number {
	return Math.max(0, freeTimeEnd - now);
}
