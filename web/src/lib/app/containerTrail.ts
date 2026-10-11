/**
 * Turns `containers.get` / `containers.byNumber` data into the memo trail the container page and
 * the disputes drawer show: every on-chain event with its memo, finality and hash, plus the
 * lifecycle milestones that have no transaction. Failed attempts (a refused second pull) become
 * red "refused" entries.
 */
import type { FunctionReturnType } from 'convex/server';
import type { TimelineEntry, TimelineKind } from '../ui/types';
import type { api } from './api';
import { units } from './format';
import { formatMoney as formatUsd } from '../ui/format';

export type ContainerDetail = NonNullable<FunctionReturnType<typeof api.containers.byNumber>>;
type Payment = ContainerDetail['payments'][number];

const PAYMENT_KIND: Record<string, { kind: TimelineKind; title: string }> = {
	deposit: { kind: 'deposit', title: 'Deposit held by protocol' },
	detention_pull: { kind: 'pull', title: 'Detention pull' },
	charge: { kind: 'charge', title: 'Charges paid to the line' },
	refund: { kind: 'refund', title: 'Refund to the importer' },
	held_transfer: { kind: 'held', title: 'Transfer held by the guard' },
	held_return: { kind: 'held', title: 'Held transfer returned' },
	key_authorized: { kind: 'authorization', title: 'Access key authorized' },
	key_revoked: { kind: 'revocation', title: 'Access key revoked' },
	dispute_release: { kind: 'dispute', title: 'Disputed funds released' }
};

/** Lifecycle events that already show as a transaction in the trail. */
const DUPLICATES = new Set([
	'deposit_held',
	'deposit_added',
	'partial_deposit',
	'detention_pull',
	'authorized',
	'key_revoked',
	'pull_refused',
	'refunded'
]);

const EVENT_KIND: Record<string, TimelineKind> = {
	requested: 'request',
	released: 'release',
	in_free_time: 'note',
	in_detention: 'note',
	returned: 'return',
	return_submitted: 'return',
	return_contested: 'dispute',
	charges_posted: 'charge',
	settled: 'settlement',
	settled_disputed: 'settlement',
	dispute_resolved: 'dispute'
};

export function isRefusedPull(p: Payment): boolean {
	return p.kind === 'detention_pull' && p.status === 'failed';
}

export function paymentEntry(p: Payment, names: { line: string; importer: string }): TimelineEntry {
	const base = PAYMENT_KIND[p.kind] ?? { kind: 'note' as const, title: p.kind };
	const amount = units(p.amountUnits);
	if (isRefusedPull(p)) {
		return {
			id: `p-${p._id}`,
			kind: 'refused',
			title: `${p.error ?? 'SpendingLimitExceeded'}: second pull${p.day ? ` on day ${p.day}` : ''} refused`,
			timestamp: p.timestamp,
			amount,
			memo: p.memo,
			status: 'failed',
			actor: names.line,
			detail: 'Recurring limit enforced by the protocol, not by our app'
		};
	}
	const detail =
		p.kind === 'key_authorized'
			? `No money moved. ${names.importer} authorized ${names.line} to pull up to ${formatUsd(units(p.amountUnits))} per day, payable only to the line.`
			: p.kind === 'key_revoked'
				? 'The line can no longer pull from this account for this container.'
				: p.kind === 'deposit'
					? `${names.importer} to ${names.line}'s protocol guard`
					: p.kind === 'refund'
						? `Back to ${names.importer}`
						: p.kind === 'charge'
							? `To ${names.line}`
							: undefined;
	return {
		id: `p-${p._id}`,
		kind: base.kind,
		title: p.kind === 'detention_pull' && p.day ? `Detention pull, day ${p.day}` : base.title,
		timestamp: p.timestamp,
		amount:
			amount > 0n && p.kind !== 'key_authorized' && p.kind !== 'key_revoked' ? amount : undefined,
		memo: p.memo || undefined,
		txHash: p.displayHash || undefined,
		href: p.explorerUrl ?? undefined,
		finalityMs: p.status === 'confirmed' ? p.finalityMs : undefined,
		status: p.status,
		detail
	};
}

export function buildTrail(d: ContainerDetail): TimelineEntry[] {
	const names = { line: d.line.name, importer: d.importer.name };
	const out: TimelineEntry[] = d.payments.map((p) => paymentEntry(p, names));
	for (const e of d.events) {
		if (DUPLICATES.has(e.kind)) continue;
		out.push({
			id: `e-${e._id}`,
			kind: EVENT_KIND[e.kind] ?? 'note',
			title: e.title,
			timestamp: e.at,
			detail: e.detail,
			actor: e.actor
		});
	}
	return out;
}
