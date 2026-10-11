/**
 * Chain orchestration for actions (ARCHITECTURE section 6). One place that branches on
 * TEMPO_MODE: `sim` calls the internal mutations in `sim.ts`, `live` calls the node actions in
 * `tempoNode.ts` (owned by TEMPO-LIVE; referenced by name so this compiles without the file).
 *
 * Every function returns `{ ok: true, ... } | { ok: false, error }` and never throws for
 * chain-level refusals. The caller records intent first (pendingOnChain), calls one of these,
 * then records the result in a second mutation.
 */
import { makeFunctionReference } from 'convex/server';
import { internal } from './_generated/api';
import type { ActionCtx } from './_generated/server';
import { chainMode, randomHex, sleep, simFinalitySleepEnabled } from './helpers';
import {
	toMs,
	type HeldReceiptJson,
	type TxResultJson,
	type Hex
} from '../lib/shared/tempo/adapter';
import type { SimLeg } from '../lib/shared/tempo/sim';
import { ALPHA_USD } from '../lib/shared/domain/constants';

export interface ChainErr {
	name: string;
	message: string;
	remainingUnits?: string;
	periodEnd?: number;
	/** Infrastructure failure (RPC down): retry later, do not give up on the step. */
	retryable?: boolean;
	[k: string]: string | number | boolean | undefined;
}
export type Chain<T> = ({ ok: true } & T) | { ok: false; error: ChainErr };

// --- live node actions (TEMPO-LIVE), referenced by name -----------------------------------

type PullLive = TxResultJson | { error: 'SpendingLimitExceeded'; remainingUnits: string; periodEnd: number };

const liveConfirmDeposits = makeFunctionReference<'action', { txHash: string }, HeldReceiptJson[]>(
	'tempoNode:confirmDeposits'
);
const liveCreateAccessKey = makeFunctionReference<'action', Record<string, never>, { keyAddress: string; encPrivKey: string }>(
	'tempoNode:createAccessKey'
);
const livePullDetention = makeFunctionReference<
	'action',
	{ account: string; encPrivKey: string; to: string; amountUnits: string; memo: string },
	PullLive
>('tempoNode:pullDetention');
const liveGetAccessKeyState = makeFunctionReference<
	'action',
	{ account: string; keyAddress: string },
	{ remainingUnits: string; periodEnd: number; expiry: number; isRevoked: boolean }
>('tempoNode:getAccessKeyState');
const liveSettle = makeFunctionReference<
	'action',
	{
		items: {
			receipt: string;
			chargeUnits: string;
			disputedUnits: string;
			chargeMemo: string;
			refundMemo: string;
		}[];
	},
	TxResultJson
>('tempoNode:settle');
const liveResolveDispute = makeFunctionReference<
	'action',
	{ receipt: string; toLineUnits: string; memo: string },
	TxResultJson
>('tempoNode:resolveDispute');
const liveReturnHeldTransfer = makeFunctionReference<'action', { receipt: string }, TxResultJson>(
	'tempoNode:returnHeldTransfer'
);
const liveListHeldReceipts = makeFunctionReference<
	'action',
	{ depositsAccount: string; fromBlock: string },
	{ receipts: HeldReceiptJson[]; toBlock: string }
>('tempoNode:listHeldReceipts');
const liveFundFromFaucet = makeFunctionReference<'action', { address: string }, TxResultJson[]>(
	'tempoNode:fundFromFaucet'
);

function rpcFail(e: unknown): { ok: false; error: ChainErr } {
	return { ok: false, error: { name: 'RpcError', message: e instanceof Error ? e.message : String(e), retryable: true } };
}

async function waitFinality(ms: number): Promise<void> {
	if (simFinalitySleepEnabled() && ms > 0) await sleep(ms);
}

// --- deposits -----------------------------------------------------------------------------

/** Sim only: the payer's batch of deposit transfers, atomic, then wait for finality. */
export async function chainPayBatch(
	ctx: ActionCtx,
	a: { payer: string; items: { to: string; amountUnits: string; memo: Hex }[]; at?: number }
): Promise<Chain<{ tx: TxResultJson; held: HeldReceiptJson[] }>> {
	if (chainMode() === 'live') {
		return { ok: false, error: { name: 'NotSupported', message: 'In live mode the browser submits the batch with a passkey.' } };
	}
	const r = await ctx.runMutation(internal.sim.transferBatch, {
		from: a.payer,
		token: ALPHA_USD,
		calls: a.items.map((i) => ({ to: i.to, amountUnits: i.amountUnits, memo: i.memo })),
		at: a.at
	});
	if (!r.ok) return r;
	await waitFinality(r.tx.finalityMs);
	return r;
}

/** Live only: re-read the browser-submitted transaction and return the guard receipts. */
export async function chainConfirmDeposits(ctx: ActionCtx, txHash: string): Promise<Chain<{ held: HeldReceiptJson[] }>> {
	try {
		const held = await ctx.runAction(liveConfirmDeposits, { txHash });
		return { ok: true, held };
	} catch (e) {
		return rpcFail(e);
	}
}

// --- access keys --------------------------------------------------------------------------

export async function chainCreateAccessKey(ctx: ActionCtx): Promise<Chain<{ keyAddress: string; encPrivKey: string }>> {
	if (chainMode() === 'live') {
		try {
			const k = await ctx.runAction(liveCreateAccessKey, {});
			return { ok: true, ...k };
		} catch (e) {
			return rpcFail(e);
		}
	}
	// Sim: a random 20-byte key id. The "private key" is a placeholder; the sim keychain never signs.
	return { ok: true, keyAddress: `0x${randomHex(20)}`, encPrivKey: `sim:${randomHex(32)}` };
}

export async function chainAuthorizeKey(
	ctx: ActionCtx,
	a: {
		account: string;
		keyAddress: string;
		limitUnits: string;
		periodSec: number;
		recipient: string;
		expiry: number;
		at?: number;
	}
): Promise<Chain<{ tx: TxResultJson }>> {
	if (chainMode() === 'live') {
		return { ok: false, error: { name: 'NotSupported', message: 'In live mode the importer authorizes the key in the browser.' } };
	}
	const r = await ctx.runMutation(internal.sim.authorizeKey, {
		account: a.account,
		keyId: a.keyAddress,
		limitUnits: a.limitUnits,
		periodSec: a.periodSec,
		recipients: [a.recipient],
		expiry: a.expiry,
		at: a.at
	});
	if (!r.ok) return r;
	await waitFinality(r.tx.finalityMs);
	return r;
}

export async function chainKeyState(
	ctx: ActionCtx,
	a: { account: string; keyAddress: string; at?: number }
): Promise<Chain<{ remainingUnits: string; periodEnd: number; expiry: number; isRevoked: boolean; exists: boolean }>> {
	if (chainMode() === 'live') {
		try {
			const s = await ctx.runAction(liveGetAccessKeyState, { account: a.account, keyAddress: a.keyAddress });
			return { ok: true, ...s, periodEnd: toMs(s.periodEnd), expiry: toMs(s.expiry), exists: s.expiry !== 0 };
		} catch (e) {
			return rpcFail(e);
		}
	}
	const s = await ctx.runQuery(internal.sim.keyState, { account: a.account, keyId: a.keyAddress, at: a.at });
	return { ok: true, ...s };
}

export async function chainPull(
	ctx: ActionCtx,
	a: {
		account: string;
		keyAddress: string;
		encPrivKey: string;
		to: string;
		amountUnits: string;
		memo: Hex;
		/** Sim only: the product time the pull is due. */
		at?: number;
	}
): Promise<Chain<{ tx: TxResultJson; remainingUnits?: string }>> {
	if (chainMode() === 'live') {
		try {
			const r = await ctx.runAction(livePullDetention, {
				account: a.account,
				encPrivKey: a.encPrivKey,
				to: a.to,
				amountUnits: a.amountUnits,
				memo: a.memo
			});
			if ('error' in r) {
				return {
					ok: false,
					error: {
						name: r.error,
						message: 'Spending limit exceeded (refused by the chain)',
						remainingUnits: r.remainingUnits,
						periodEnd: toMs(r.periodEnd)
					}
				};
			}
			return { ok: true, tx: r };
		} catch (e) {
			return rpcFail(e);
		}
	}
	const r = await ctx.runMutation(internal.sim.pull, {
		account: a.account,
		keyId: a.keyAddress,
		to: a.to,
		amountUnits: a.amountUnits,
		memo: a.memo,
		at: a.at
	});
	if (!r.ok) return r;
	await waitFinality(r.tx.finalityMs);
	return r;
}

/**
 * Revocation. Sim: performed for the importer (stands in for the pre-signed revoke). Live: only the
 * importer root key can revoke, so this just reports whether the chain says the key is revoked.
 */
export async function chainRevokeKey(
	ctx: ActionCtx,
	a: { account: string; keyAddress: string; at?: number }
): Promise<Chain<{ tx: TxResultJson | null }>> {
	if (chainMode() === 'live') {
		const s = await chainKeyState(ctx, a);
		if (!s.ok) return s;
		if (!s.isRevoked) {
			return { ok: false, error: { name: 'RevocationPending', message: 'The importer has not revoked this key yet.' } };
		}
		return { ok: true, tx: null };
	}
	const r = await ctx.runMutation(internal.sim.revokeKey, { account: a.account, keyId: a.keyAddress, at: a.at });
	if (!r.ok) return r;
	await waitFinality(r.tx.finalityMs);
	return { ok: true, tx: r.tx };
}

// --- settlement ---------------------------------------------------------------------------

export interface SettleItem {
	receiptId: string;
	receipt: string;
	chargeUnits: string;
	disputedUnits: string;
	chargeMemo: Hex;
	refundMemo: Hex;
}

export async function chainSettle(
	ctx: ActionCtx,
	a: { items: SettleItem[]; at?: number }
): Promise<Chain<{ tx: TxResultJson; legs: SimLeg[] }>> {
	if (chainMode() === 'live') {
		try {
			const tx = await ctx.runAction(liveSettle, {
				items: a.items.map((i) => ({
					receipt: i.receipt,
					chargeUnits: i.chargeUnits,
					disputedUnits: i.disputedUnits,
					chargeMemo: i.chargeMemo,
					refundMemo: i.refundMemo
				}))
			});
			return { ok: true, tx, legs: [] };
		} catch (e) {
			return rpcFail(e);
		}
	}
	const r = await ctx.runMutation(internal.sim.settle, {
		items: a.items.map((i) => ({
			receiptId: i.receiptId,
			chargeUnits: i.chargeUnits,
			disputedUnits: i.disputedUnits,
			chargeMemo: i.chargeMemo,
			refundMemo: i.refundMemo
		})),
		at: a.at
	});
	if (!r.ok) return r;
	if (!r.alreadySettled) await waitFinality(r.tx.finalityMs);
	return r;
}

export async function chainResolveDispute(
	ctx: ActionCtx,
	a: { receiptId: string; receipt: string; toLineUnits: string; memo: Hex; at?: number }
): Promise<Chain<{ tx: TxResultJson; legs: SimLeg[] }>> {
	if (chainMode() === 'live') {
		try {
			const tx = await ctx.runAction(liveResolveDispute, { receipt: a.receipt, toLineUnits: a.toLineUnits, memo: a.memo });
			return { ok: true, tx, legs: [] };
		} catch (e) {
			return rpcFail(e);
		}
	}
	const r = await ctx.runMutation(internal.sim.resolveDispute, {
		receiptId: a.receiptId,
		toLineUnits: a.toLineUnits,
		memo: a.memo,
		at: a.at
	});
	if (!r.ok) return r;
	await waitFinality(r.tx.finalityMs);
	return r;
}

export async function chainReturnToSender(
	ctx: ActionCtx,
	a: { receiptId: string; receipt: string; memo: Hex; at?: number }
): Promise<Chain<{ tx: TxResultJson; legs: SimLeg[] }>> {
	if (chainMode() === 'live') {
		try {
			const tx = await ctx.runAction(liveReturnHeldTransfer, { receipt: a.receipt });
			return { ok: true, tx, legs: [] };
		} catch (e) {
			return rpcFail(e);
		}
	}
	const r = await ctx.runMutation(internal.sim.returnToSender, { receiptId: a.receiptId, memo: a.memo, at: a.at });
	if (!r.ok) return r;
	await waitFinality(r.tx.finalityMs);
	return r;
}

// --- indexer / faucet ---------------------------------------------------------------------

/** Live only: guard receipts seen since `fromBlock` for a deposits account. */
export async function chainListHeldReceipts(
	ctx: ActionCtx,
	a: { depositsAccount: string; fromBlock: string }
): Promise<Chain<{ receipts: HeldReceiptJson[]; toBlock: string }>> {
	if (chainMode() !== 'live') return { ok: true, receipts: [], toBlock: a.fromBlock };
	try {
		const r = await ctx.runAction(liveListHeldReceipts, a);
		return { ok: true, ...r };
	} catch (e) {
		return rpcFail(e);
	}
}

export async function chainFund(ctx: ActionCtx, address: string): Promise<void> {
	if (chainMode() === 'live') {
		await ctx.runAction(liveFundFromFaucet, { address });
		return;
	}
	await ctx.runMutation(internal.sim.fund, { address });
}

export function errMessage(e: ChainErr): string {
	return e.message;
}
