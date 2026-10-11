/** Shapes returned to the frontend. Money stays as base-unit strings; secrets never leave. */
import type { Doc, Id } from './_generated/dataModel';
import type { DatabaseReader } from './_generated/server';
import { chainMode } from './helpers';
import { makeSimStore } from './simStore';
import {
	ALPHA_USD,
	DEFAULT_SETTLEMENT_WINDOW_DAYS,
	DEFAULT_SILENT_GRACE_HOURS
} from '../lib/shared/domain/constants';
import { u } from '../lib/shared/domain/money';

export type AccessKeyView = Omit<Doc<'accessKeys'>, 'encPrivKey'>;

export function publicKey(k: Doc<'accessKeys'>): AccessKeyView {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const { encPrivKey, ...rest } = k;
	return rest;
}

export function publicOrg(o: Doc<'organizations'>) {
	return {
		_id: o._id,
		kind: o.kind,
		name: o.name,
		shortCode: o.shortCode,
		country: o.country,
		tempoAddress: o.tempoAddress ?? null,
		depositsAccount: o.depositsAccount ?? null,
		chargesAddress: o.chargesAddress ?? null,
		settlementContract: o.settlementContract ?? null,
		masterId: o.masterId ?? null
	};
}

export interface ContainerView extends Doc<'containers'> {
	receivedUnits: string;
	missingUnits: string;
	covered: boolean;
	pendingOnChainFlag: boolean;
	requestCode: string;
	billOfLading: string;
	lineName: string;
	importerName: string;
	accessKey: AccessKeyView | null;
	/** Disputed amount waiting for the resolver (0 when none). */
	escrowUnits: string;
}

export async function containerView(
	ctx: { db: DatabaseReader },
	c: Doc<'containers'>,
	cache?: Map<string, unknown>
): Promise<ContainerView> {
	const get = async <T>(key: string, load: () => Promise<T>): Promise<T> => {
		if (cache?.has(key)) return cache.get(key) as T;
		const v = await load();
		cache?.set(key, v);
		return v;
	};
	const request = await get(`req:${c.requestId}`, () => ctx.db.get(c.requestId));
	const line = await get(`org:${c.lineOrgId}`, () => ctx.db.get(c.lineOrgId));
	const importer = await get(`org:${c.importerOrgId}`, () => ctx.db.get(c.importerOrgId));
	const key =
		c.mode === 'depositFree'
			? await ctx.db
					.query('accessKeys')
					.withIndex('by_container', (q) => q.eq('containerId', c._id))
					.first()
			: null;
	const received = c.receivedUnits ?? '0';
	const missing = u(c.depositUnits) - u(received);
	let escrow = 0n;
	if (c.state === 'disputed' && c.disputeId) {
		const d = await ctx.db.get(c.disputeId);
		if (d && d.status === 'open') escrow = u(d.disputedUnits);
	}
	return {
		...c,
		receivedUnits: received,
		missingUnits: (missing > 0n ? missing : 0n).toString(),
		covered: c.mode === 'held' ? missing <= 0n : key?.status === 'active',
		pendingOnChainFlag: c.pendingOnChain !== undefined,
		requestCode: request?.requestCode ?? '',
		billOfLading: request?.billOfLading ?? '',
		lineName: line?.name ?? '',
		importerName: importer?.name ?? '',
		accessKey: key ? publicKey(key) : null,
		escrowUnits: escrow.toString()
	};
}

export async function simBalance(
	ctx: { db: DatabaseReader },
	address: string | undefined
): Promise<string | null> {
	if (!address || chainMode() === 'live') return null;
	const store = makeSimStore(ctx.db as never);
	return (await store.getBalance(address, ALPHA_USD)).toString();
}

export function termsFor(line: Doc<'organizations'>, request: Doc<'releaseRequests'>) {
	return {
		mode: request.mode,
		settlementWindowDays: line.settlementWindowDays ?? DEFAULT_SETTLEMENT_WINDOW_DAYS,
		maxDetentionDays: line.maxDetentionDays ?? 30,
		/** Hours after the return date before an importer may submit the receipt themselves. */
		silentGraceHours: line.silentGraceHours ?? DEFAULT_SILENT_GRACE_HOURS,
		refundRule:
			request.mode === 'held'
				? 'Your deposit is held by the Tempo protocol guard, not by the line. When the empty is returned and the line records it, any remainder after detention and damage refunds to you automatically, no later than the end of the settlement window.'
				: 'No money moves now. After free time ends the line can pull at most one day of detention per day, only to its own charges address, until the empty is returned. The key is revoked at settlement.',
		detentionRule:
			'Detention is charged per started day after free time ends, up to the deposit amount. Final charges cannot exceed the deposit, or accrued detention plus stated damage.',
		disputeRule:
			'You can dispute posted charges once, inside the window. Only the disputed amount stays held; the rest settles immediately.'
	};
}

export type { Id };
