/**
 * Plain mutation-context operations for release requests. Public functions in
 * `releaseRequests.ts` wrap these; `seed.ts` calls them directly with historical timestamps.
 */
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { appError, chainMode, env, logEvent, notify, randomCode } from './helpers';
import { checkContainerNumber } from '../lib/shared/domain/containerNumber';
import {
	DEFAULT_CLEAN_RETURNS_FOR_DEPOSIT_FREE,
	DEFAULT_MAX_DETENTION_DAYS
} from '../lib/shared/domain/constants';
import { depositAddressFor, DEFAULT_ENV_PREFIX } from '../lib/shared/domain/virtualAddress';
import { formatUsd } from '../lib/shared/domain/money';
import { suggestedMode, type DepositMode } from '../lib/shared/domain/rules';

type ContainerType = Doc<'containers'>['type'];

export interface CreateRequestArgs {
	line: Doc<'organizations'>;
	user: Doc<'users'>;
	importerOrgId: Id<'organizations'>;
	billOfLading: string;
	vessel?: string;
	voyage?: string;
	portOfDischarge: string;
	mode: DepositMode;
	containers: { number: string; type: ContainerType }[];
	now: number;
	/** Seed only: bypass duplicate-number checks for numbers that are historical. */
	skipActiveCheck?: boolean;
}

export async function envPrefix(ctx: MutationCtx): Promise<number> {
	if (chainMode() === 'live') {
		const raw = env('VA_ENV_PREFIX');
		const n = raw ? Number(raw) : NaN;
		if (Number.isInteger(n) && n >= 0 && n <= 0xffff) return n;
		return DEFAULT_ENV_PREFIX;
	}
	const meta = await ctx.db.query('sim_meta').first();
	return meta?.envPrefix ?? DEFAULT_ENV_PREFIX;
}

/** The resolver both sides agreed to at onboarding: the line's choice, else the platform, else the line. */
export async function defaultResolver(
	ctx: MutationCtx,
	line: Doc<'organizations'>
): Promise<Id<'organizations'>> {
	if (line.resolverOrgId) return line.resolverOrgId;
	const platform = await ctx.db
		.query('organizations')
		.withIndex('by_kind', (q) => q.eq('kind', 'platform'))
		.first();
	return platform?._id ?? line._id;
}

export async function ensureRelationship(
	ctx: MutationCtx,
	line: Doc<'organizations'>,
	importerOrgId: Id<'organizations'>,
	mode: DepositMode
): Promise<Doc<'relationships'>> {
	const existing = await ctx.db
		.query('relationships')
		.withIndex('by_pair', (q) => q.eq('lineOrgId', line._id).eq('importerOrgId', importerOrgId))
		.unique();
	if (existing) return existing;
	const id = await ctx.db.insert('relationships', {
		lineOrgId: line._id,
		importerOrgId,
		defaultMode: mode,
		cleanReturns: 0,
		lateReturns: 0,
		disputes: 0,
		resolverOrgId: await defaultResolver(ctx, line)
	});
	return (await ctx.db.get(id))!;
}

/**
 * Deposit-free is only for importers with a clean track record: the same rule as
 * `orgs.listImporters` `suggestedMode` (clean returns at the line's threshold, no open disputes).
 * Called by the public `releaseRequests.create`; the seed calls `createReleaseRequest` directly.
 */
export async function assertDepositFreeEligible(
	ctx: MutationCtx,
	line: Doc<'organizations'>,
	importerOrgId: Id<'organizations'>
): Promise<void> {
	const importer = await ctx.db.get(importerOrgId);
	if (!importer || importer.kind !== 'importer') return; // createReleaseRequest reports NOT_FOUND
	const rel = await ctx.db
		.query('relationships')
		.withIndex('by_pair', (q) => q.eq('lineOrgId', line._id).eq('importerOrgId', importerOrgId))
		.unique();
	const openDisputes = (
		await ctx.db
			.query('disputes')
			.withIndex('by_line_status', (q) => q.eq('lineOrgId', line._id).eq('status', 'open'))
			.collect()
	).filter((d) => d.importerOrgId === importerOrgId).length;
	const threshold = line.cleanReturnsForDepositFree ?? DEFAULT_CLEAN_RETURNS_FOR_DEPOSIT_FREE;
	const cleanReturns = rel?.cleanReturns ?? 0;
	if (
		suggestedMode({ cleanReturns, openDisputes, cleanReturnsForDepositFree: threshold }) ===
		'depositFree'
	)
		return;
	const name = importer.name;
	const reason =
		openDisputes > 0
			? `${name} has ${openDisputes} open dispute${openDisputes === 1 ? '' : 's'}.`
			: `${name} has ${cleanReturns} clean return${cleanReturns === 1 ? '' : 's'} with you; deposit-free needs ${threshold}.`;
	throw appError('NOT_ELIGIBLE', `${reason} Use a held deposit for this request.`, {
		cleanReturns,
		openDisputes,
		required: threshold
	});
}

async function uniqueRequestCode(ctx: MutationCtx): Promise<string> {
	for (let i = 0; i < 20; i++) {
		const code = randomCode(6);
		const clash = await ctx.db
			.query('releaseRequests')
			.withIndex('by_code', (q) => q.eq('requestCode', code))
			.first();
		if (!clash) return code;
	}
	throw appError('CONFLICT', 'Could not allocate a request code. Try again.');
}

export async function createReleaseRequest(
	ctx: MutationCtx,
	a: CreateRequestArgs
): Promise<{
	requestId: Id<'releaseRequests'>;
	requestCode: string;
	containerIds: Id<'containers'>[];
}> {
	const { now } = a;
	// Always work from the current row: the per-line sequence counter must never be stale.
	const line = (await ctx.db.get(a.line._id)) ?? a.line;
	if (line.kind !== 'line')
		throw appError('FORBIDDEN', 'Only shipping lines create release requests.');
	const importer = await ctx.db.get(a.importerOrgId);
	if (!importer || importer.kind !== 'importer') throw appError('NOT_FOUND', 'Importer not found.');
	const bl = a.billOfLading.trim();
	if (!bl) throw appError('INVALID', 'Enter the bill of lading number.');
	if (!a.portOfDischarge.trim()) throw appError('INVALID', 'Enter the port of discharge.');
	if (a.containers.length === 0) throw appError('INVALID', 'Add at least one container.');
	if (a.containers.length > 40)
		throw appError('INVALID', 'A request can hold at most 40 containers.');
	if (!line.masterId)
		throw appError('INVALID', 'Set up the deposits account in settings before creating requests.');

	// Validate numbers and uniqueness.
	const seen = new Set<string>();
	const normalized: { number: string; type: ContainerType }[] = [];
	for (const c of a.containers) {
		const check = checkContainerNumber(c.number);
		if (!check.ok)
			throw appError('INVALID_CONTAINER', `${c.number}: ${check.reason}`, { number: c.number });
		if (seen.has(check.number))
			throw appError('INVALID_CONTAINER', `${check.number} is listed twice.`, {
				number: check.number
			});
		seen.add(check.number);
		normalized.push({ number: check.number, type: c.type });
		if (!a.skipActiveCheck) {
			const clash = await ctx.db
				.query('containers')
				.withIndex('by_number', (q) => q.eq('number', check.number))
				.collect();
			if (clash.some((x) => x.lineOrgId === line._id && x.state !== 'settled')) {
				throw appError('CONFLICT', `${check.number} already has an open release request.`, {
					number: check.number
				});
			}
		}
	}

	// Rate cards.
	const cards = await ctx.db
		.query('rateCards')
		.withIndex('by_line', (q) => q.eq('lineOrgId', line._id))
		.collect();
	const cardFor = (t: ContainerType) => cards.find((c) => c.containerType === t);
	for (const c of normalized) {
		if (!cardFor(c.type))
			throw appError('INVALID', `No rate card for ${c.type}. Add one in settings.`);
	}

	await ensureRelationship(ctx, line, a.importerOrgId, a.mode);

	const requestCode = await uniqueRequestCode(ctx);
	const requestId = await ctx.db.insert('releaseRequests', {
		lineOrgId: line._id,
		importerOrgId: a.importerOrgId,
		billOfLading: bl,
		vessel: a.vessel?.trim() || undefined,
		voyage: a.voyage?.trim() || undefined,
		portOfDischarge: a.portOfDischarge.trim(),
		mode: a.mode,
		status: 'awaiting_importer',
		createdBy: a.user._id,
		createdAt: now,
		requestCode
	});

	const prefix = await envPrefix(ctx);
	let seq = line.nextSeq ?? 1;
	const maxDetentionDays = line.maxDetentionDays ?? DEFAULT_MAX_DETENTION_DAYS;
	const containerIds: Id<'containers'>[] = [];
	let totalDeposit = 0n;
	for (const c of normalized) {
		const card = cardFor(c.type)!;
		const depositAddress = depositAddressFor({ masterId: line.masterId, envPrefix: prefix, seq });
		const id = await ctx.db.insert('containers', {
			requestId,
			lineOrgId: line._id,
			importerOrgId: a.importerOrgId,
			number: c.number,
			type: c.type,
			mode: a.mode,
			seq,
			depositAddress,
			depositUnits: card.depositUnits,
			dailyRateUnits: card.dailyRateUnits,
			freeDays: card.freeDays,
			maxDetentionDays,
			state: a.mode === 'held' ? 'awaiting_deposit' : 'requested',
			stateChangedAt: now,
			createdAt: now,
			receivedUnits: '0',
			detentionDays: 0,
			accruedUnits: '0',
			pulledUnits: '0'
		});
		seq++;
		totalDeposit += BigInt(card.depositUnits);
		containerIds.push(id);
		await logEvent(
			ctx,
			id,
			'requested',
			'Release requested',
			now,
			`${a.mode === 'held' ? 'Held deposit' : 'Deposit-free'} for bill of lading ${bl}. Deposit address ${depositAddress}.`,
			a.user.name
		);
	}
	await ctx.db.patch(line._id, { nextSeq: seq });

	await notify(ctx, {
		orgId: a.importerOrgId,
		kind: 'release_request',
		title: `Release request ${bl}`,
		body:
			a.mode === 'held'
				? `${line.name} needs ${formatUsd(totalDeposit)} in deposits for ${normalized.length} container${normalized.length === 1 ? '' : 's'}. Open the request to pay in one tap.`
				: `${line.name} requests deposit-free release for ${normalized.length} container${normalized.length === 1 ? '' : 's'}. Authorize the access key to continue.`,
		at: now
	});
	return { requestId, requestCode, containerIds };
}

/** Recompute the request status from its containers. */
export async function refreshRequestStatus(
	ctx: MutationCtx,
	requestId: Id<'releaseRequests'>
): Promise<void> {
	const request = await ctx.db.get(requestId);
	if (!request || request.status === 'cancelled') return;
	const containers = await ctx.db
		.query('containers')
		.withIndex('by_request', (q) => q.eq('requestId', requestId))
		.collect();
	let status: Doc<'releaseRequests'>['status'] = 'awaiting_importer';
	if (containers.length > 0 && containers.every((c) => c.state === 'settled')) status = 'completed';
	else if (containers.some((c) => c.state !== 'requested' && c.state !== 'awaiting_deposit'))
		status = 'active';
	else if (containers.some((c) => BigInt(c.receivedUnits ?? '0') > 0n)) status = 'active';
	if (status !== request.status) await ctx.db.patch(requestId, { status });
}
