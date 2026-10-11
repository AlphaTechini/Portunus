/**
 * Turning guard receipts into app records. One function serves every source: the importer's
 * own batch (sim or live), the live indexer, and stray transfers sent by strangers.
 *
 * A receipt addressed to a container's virtual address, in the settlement token, from the
 * importer, is a deposit. Anything else is a held transfer waiting to be returned.
 */
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { importerAddresses, lc, logEvent, notify, setState } from './helpers';
import { refreshRequestStatus } from './opsRequests';
import type { HeldReceiptJson } from '../lib/shared/tempo/adapter';
import { toMs } from '../lib/shared/tempo/adapter';
import { decodeMemo } from '../lib/shared/domain/memo';
import { SETTLEMENT_TOKEN, tokenSymbol } from '../lib/shared/domain/constants';
import { formatUsd, u } from '../lib/shared/domain/money';
import { isVirtualAddress, parseVirtualAddress } from '../lib/shared/domain/virtualAddress';

export interface IngestResult {
	deposits: { containerId: Id<'containers'>; paymentId: Id<'payments'>; amountUnits: string }[];
	heldTransfers: Id<'heldTransfers'>[];
	skipped: number;
	touchedContainers: Id<'containers'>[];
}

const ACCEPTING: Doc<'containers'>['state'][] = [
	'awaiting_deposit',
	'deposit_held',
	'released',
	'in_free_time',
	'in_detention',
	'returned'
];

export async function ingestReceipts(
	ctx: MutationCtx,
	receipts: HeldReceiptJson[],
	opts: {
		mode: 'sim' | 'live';
		finalityMs: number;
		now: number;
		blockNumber?: string;
		approvedWith?: 'passkey' | 'demo';
	}
): Promise<IngestResult> {
	const out: IngestResult = { deposits: [], heldTransfers: [], skipped: 0, touchedContainers: [] };
	for (const r of receipts) {
		// Idempotent: a receipt id is recorded at most once.
		const already = await ctx.db
			.query('payments')
			.withIndex('by_tx', (q) => q.eq('txHash', r.txHash))
			.collect();
		const seenHeld = await ctx.db
			.query('heldTransfers')
			.withIndex('by_receipt', (q) => q.eq('receiptId', r.id))
			.first();
		if (seenHeld || already.some((p) => p.receiptId === r.id)) {
			out.skipped++;
			continue;
		}
		const recipient = lc(r.recipient);
		const token = lc(r.token);
		const originator = lc(r.originator);
		const at = toMs(r.blockedAt);
		const memoText = safeDecode(r.memo);
		const container = await ctx.db
			.query('containers')
			.withIndex('by_deposit_address', (q) => q.eq('depositAddress', recipient))
			.first();

		let reason: Doc<'heldTransfers'>['reason'] | null = null;
		let lineOrgId: Id<'organizations'> | undefined = container?.lineOrgId;
		if (container) {
			if (token !== SETTLEMENT_TOKEN) reason = 'wrong_token';
			else {
				const importer = await ctx.db.get(container.importerOrgId);
				const senders = importer ? await importerAddresses(ctx, importer) : [];
				if (!senders.includes(originator)) reason = 'unknown_sender';
				else if (container.mode !== 'held' || !ACCEPTING.includes(container.state))
					reason = 'excess';
			}
		} else {
			lineOrgId = await lineForAddress(ctx, recipient);
			reason = token !== SETTLEMENT_TOKEN ? 'wrong_token' : 'unknown_sender';
		}

		if (reason === null && container) {
			const paymentId = await ctx.db.insert('payments', {
				kind: 'deposit',
				mode: opts.mode,
				containerId: container._id,
				requestId: container.requestId,
				lineOrgId: container.lineOrgId,
				importerOrgId: container.importerOrgId,
				from: originator,
				to: recipient,
				token,
				amountUnits: r.amount,
				memo: memoText,
				memoHex: r.memo,
				txHash: r.txHash,
				logIndex: r.logIndex,
				blockNumber: opts.blockNumber,
				finalityMs: opts.finalityMs,
				timestamp: at,
				status: 'confirmed',
				receiptId: r.id,
				receipt: r.receipt,
				approvedWith: opts.approvedWith
			});
			const received = u(container.receivedUnits ?? '0') + u(r.amount);
			const patch: Partial<Doc<'containers'>> = {
				receivedUnits: received.toString(),
				heldReceiptId: container.heldReceiptId ?? r.id
			};
			await ctx.db.patch(container._id, patch);
			const required = u(container.depositUnits);
			if (container.state === 'awaiting_deposit' && received >= required) {
				await setState(ctx, { ...container, ...patch }, 'deposit_held', at);
				await logEvent(
					ctx,
					container._id,
					'deposit_held',
					'Deposit held by protocol',
					at,
					`${formatUsd(received)} is in the receive-policy guard. It never entered the line's balance.`
				);
				await notify(ctx, {
					orgId: container.lineOrgId,
					kind: 'deposit_held',
					title: `Deposit held: ${container.number}`,
					body: `${formatUsd(received)} is held by the protocol. You can issue the release order.`,
					containerId: container._id,
					at
				});
				await notify(ctx, {
					orgId: container.importerOrgId,
					kind: 'deposit_held',
					title: `Deposit paid: ${container.number}`,
					body: `${formatUsd(received)} is held by the protocol, not by the line. It refunds when the empty is back.`,
					containerId: container._id,
					at
				});
			} else if (container.state === 'awaiting_deposit') {
				await logEvent(
					ctx,
					container._id,
					'partial_deposit',
					'Partial deposit received',
					at,
					`${formatUsd(received)} of ${formatUsd(required)}. ${formatUsd(required - received)} still missing.`
				);
				await notify(ctx, {
					orgId: container.importerOrgId,
					kind: 'partial_deposit',
					title: `Deposit incomplete: ${container.number}`,
					body: `${formatUsd(required - received)} is still missing before the release order can be issued.`,
					containerId: container._id,
					at
				});
			} else {
				await logEvent(
					ctx,
					container._id,
					'deposit_added',
					'Additional deposit held',
					at,
					formatUsd(u(r.amount))
				);
			}
			out.deposits.push({ containerId: container._id, paymentId, amountUnits: r.amount });
			if (!out.touchedContainers.includes(container._id)) out.touchedContainers.push(container._id);
			await refreshRequestStatus(ctx, container.requestId);
			continue;
		}

		// Held transfer: wrong token, unknown sender, or a payment to a container that no longer takes deposits.
		if (!lineOrgId) {
			out.skipped++;
			continue;
		}
		const id = await ctx.db.insert('heldTransfers', {
			lineOrgId,
			receiptId: r.id,
			receipt: r.receipt,
			token,
			tokenSymbol: tokenSymbol(token),
			amountUnits: r.amount,
			originator,
			recipient,
			memo: memoText,
			blockedAt: at,
			reason: reason ?? 'unknown_sender',
			status: 'held',
			containerId: container?._id,
			txHash: r.txHash,
			mode: opts.mode
		});
		await ctx.db.insert('payments', {
			kind: 'held_transfer',
			mode: opts.mode,
			containerId: container?._id,
			lineOrgId,
			from: originator,
			to: recipient,
			token,
			amountUnits: r.amount,
			memo: memoText,
			memoHex: r.memo,
			txHash: r.txHash,
			logIndex: r.logIndex,
			blockNumber: opts.blockNumber,
			finalityMs: opts.finalityMs,
			timestamp: at,
			status: 'confirmed',
			receiptId: r.id,
			receipt: r.receipt
		});
		out.heldTransfers.push(id);
		await notify(ctx, {
			orgId: lineOrgId,
			kind: 'held_transfer',
			title: reason === 'wrong_token' ? 'Wrong token held' : 'Transfer from unknown sender held',
			body: `${formatUsd(u(r.amount))} ${tokenSymbol(token)} is waiting in the guard. Return it to the sender from Held transfers.`,
			containerId: container?._id,
			at
		});
	}
	return out;
}

async function lineForAddress(
	ctx: MutationCtx,
	address: string
): Promise<Id<'organizations'> | undefined> {
	const lines = await ctx.db
		.query('organizations')
		.withIndex('by_kind', (q) => q.eq('kind', 'line'))
		.collect();
	const direct = lines.find((l) => l.depositsAccount && lc(l.depositsAccount) === address);
	if (direct) return direct._id;
	if (isVirtualAddress(address)) {
		const parsed = parseVirtualAddress(address);
		const byMaster = lines.find(
			(l) => l.masterId && parsed && lc(l.masterId) === lc(parsed.masterId)
		);
		if (byMaster) return byMaster._id;
	}
	return undefined;
}

function safeDecode(memoHex: string): string {
	try {
		return decodeMemo(memoHex);
	} catch {
		return '';
	}
}
