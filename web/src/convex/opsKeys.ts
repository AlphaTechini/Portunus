/** Plain mutation-context operations for deposit-free access keys. */
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { appError, logEvent, notify, setState } from './helpers';
import { refreshRequestStatus } from './opsRequests';
import { ALPHA_USD, DAY_MS, DAY_SEC, DEFAULT_RELEASE_ALLOWANCE_DAYS } from '../lib/shared/domain/constants';
import { keyAuthorizedMemo, keyRevokedMemo, encodeMemo } from '../lib/shared/domain/memo';
import { formatUsd, u } from '../lib/shared/domain/money';
import { depositFreeExpiry } from '../lib/shared/domain/rules';
import type { TxResultJson } from '../lib/shared/tempo/adapter';

const fmtDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/**
 * Expiry for a key authorized now. Free time has not started (the line releases after the
 * authorization), so estimate: now + release allowance + free days, then + max detention days.
 */
export function plannedKeyExpiry(c: Pick<Doc<'containers'>, 'freeDays' | 'maxDetentionDays'>, now: number): number {
	const estimatedFreeEnd = now + DEFAULT_RELEASE_ALLOWANCE_DAYS * DAY_MS + c.freeDays * DAY_MS;
	return depositFreeExpiry(estimatedFreeEnd, c.maxDetentionDays);
}

export interface KeyTerms {
	containerId: Id<'containers'>;
	number: string;
	keyAddress: string;
	token: string;
	dailyLimitUnits: string;
	periodSec: number;
	recipient: string;
	expiry: number;
	account: string;
}

export function keyTerms(key: Doc<'accessKeys'>, number: string): KeyTerms {
	return {
		containerId: key.containerId,
		number,
		keyAddress: key.keyAddress,
		token: key.token,
		dailyLimitUnits: key.dailyLimitUnits,
		periodSec: key.periodSec,
		recipient: key.recipient,
		expiry: key.expiry,
		account: key.account
	};
}

export async function insertPreparedKey(
	ctx: MutationCtx,
	a: {
		container: Doc<'containers'>;
		line: Doc<'organizations'>;
		account: string;
		keyAddress: string;
		encPrivKey: string;
		mode: 'sim' | 'live';
		now: number;
	}
): Promise<Id<'accessKeys'>> {
	if (!a.line.chargesAddress) throw appError('INVALID', 'The line has no charges address configured.');
	return ctx.db.insert('accessKeys', {
		containerId: a.container._id,
		account: a.account.toLowerCase(),
		keyAddress: a.keyAddress.toLowerCase(),
		encPrivKey: a.encPrivKey,
		token: ALPHA_USD,
		dailyLimitUnits: a.container.dailyRateUnits,
		periodSec: DAY_SEC,
		recipient: a.line.chargesAddress.toLowerCase(),
		expiry: plannedKeyExpiry(a.container, a.now),
		preparedAt: a.now,
		status: 'prepared',
		mode: a.mode
	});
}

export async function recordKeyAuthorizedOp(
	ctx: MutationCtx,
	a: {
		keyId: Id<'accessKeys'>;
		tx: TxResultJson;
		now: number;
		approvedWith?: 'passkey' | 'demo';
		actor: string;
	}
): Promise<void> {
	const key = await ctx.db.get(a.keyId);
	if (!key) throw appError('NOT_FOUND', 'Access key not found.');
	if (key.status === 'active') return; // idempotent
	const c = await ctx.db.get(key.containerId);
	if (!c) throw appError('NOT_FOUND', 'Container not found.');
	const request = await ctx.db.get(c.requestId);
	await ctx.db.patch(key._id, {
		status: 'active',
		authorizedAt: a.tx.timestamp,
		authorizeTxHash: a.tx.txHash,
		mode: a.tx.mode
	});
	const memo = keyAuthorizedMemo(c.number, request?.billOfLading ?? '');
	await ctx.db.insert('payments', {
		kind: 'key_authorized',
		mode: a.tx.mode,
		containerId: c._id,
		requestId: c.requestId,
		lineOrgId: c.lineOrgId,
		importerOrgId: c.importerOrgId,
		from: key.account,
		to: key.recipient,
		token: key.token,
		amountUnits: key.dailyLimitUnits,
		memo,
		memoHex: encodeMemo(memo),
		txHash: a.tx.txHash,
		blockNumber: a.tx.blockNumber,
		finalityMs: a.tx.finalityMs,
		timestamp: a.tx.timestamp,
		status: 'confirmed',
		approvedWith: a.approvedWith
	});
	if (c.state === 'requested') {
		await setState(ctx, c, 'authorized', a.tx.timestamp, { accessKeyId: key._id });
	} else {
		await ctx.db.patch(c._id, { accessKeyId: key._id });
	}
	await logEvent(
		ctx,
		c._id,
		'authorized',
		'Access key authorized',
		a.tx.timestamp,
		`Up to ${formatUsd(u(key.dailyLimitUnits))} per day, payable only to the line's charges address, expires ${fmtDate(key.expiry)}. No money moved.`,
		a.actor
	);
	await notify(ctx, {
		orgId: c.lineOrgId,
		kind: 'authorized',
		title: `Authorized: ${c.number}`,
		body: `Up to ${formatUsd(u(key.dailyLimitUnits))} per day. You can issue the release order.`,
		containerId: c._id,
		at: a.now
	});
	await refreshRequestStatus(ctx, c.requestId);
}

export async function recordKeyRevokedOp(
	ctx: MutationCtx,
	a: {
		keyId: Id<'accessKeys'>;
		tx: TxResultJson | null;
		now: number;
		by: 'importer' | 'settlement';
		actor: string;
	}
): Promise<void> {
	const key = await ctx.db.get(a.keyId);
	if (!key || key.status === 'revoked') return;
	const c = await ctx.db.get(key.containerId);
	const at = a.tx?.timestamp ?? a.now;
	await ctx.db.patch(key._id, { status: 'revoked', revokedAt: at, revokeRequestedAt: undefined });
	if (!c) return;
	const request = await ctx.db.get(c.requestId);
	const memo = keyRevokedMemo(c.number, c.returnReceipt?.eirNumber ?? request?.billOfLading ?? '');
	if (a.tx) {
		await ctx.db.insert('payments', {
			kind: 'key_revoked',
			mode: a.tx.mode,
			containerId: c._id,
			requestId: c.requestId,
			lineOrgId: c.lineOrgId,
			importerOrgId: c.importerOrgId,
			from: key.account,
			to: key.recipient,
			token: key.token,
			amountUnits: '0',
			memo,
			memoHex: encodeMemo(memo),
			txHash: a.tx.txHash,
			blockNumber: a.tx.blockNumber,
			finalityMs: a.tx.finalityMs,
			timestamp: at,
			status: 'confirmed'
		});
	}
	await logEvent(
		ctx,
		c._id,
		'key_revoked',
		'Access key revoked',
		at,
		a.by === 'importer'
			? 'The importer revoked the key with their root key. It can never be used again.'
			: 'Revoked at settlement. It can never be used again.',
		a.actor
	);
	if (a.by === 'importer' && !['settled', 'settling', 'returned'].includes(c.state)) {
		await notify(ctx, {
			orgId: c.lineOrgId,
			kind: 'key_revoked',
			title: `Access key revoked: ${c.number}`,
			body: 'The importer revoked the access key. Further detention cannot be pulled; the accrued amount is now uncollected exposure.',
			containerId: c._id,
			at: a.now
		});
	}
}
