import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { appError, loadRequestFor, productNow, requireLine, requireSession } from './helpers';
import { createReleaseRequest } from './opsRequests';
import { releaseRequestContainers, type ReleaseResult } from './opsLifecycle';
import { containerType, depositMode } from './schema';
import { containerView, publicOrg, simBalance, termsFor, type ContainerView } from './views';
import { u } from '../lib/shared/domain/money';
import type { Doc } from './_generated/dataModel';
import type { QueryCtx } from './_generated/server';

export const create = mutation({
	args: {
		sessionToken: v.string(),
		importerOrgId: v.id('organizations'),
		billOfLading: v.string(),
		vessel: v.optional(v.string()),
		voyage: v.optional(v.string()),
		portOfDischarge: v.string(),
		mode: depositMode,
		containers: v.array(v.object({ number: v.string(), type: containerType }))
	},
	handler: async (ctx, a) => {
		const { user, org } = await requireLine(ctx, a.sessionToken);
		const { sessionToken: _t, ...rest } = a;
		void _t;
		const r = await createReleaseRequest(ctx, {
			...rest,
			line: org,
			user,
			now: await productNow(ctx)
		});
		return { requestId: r.requestId, requestCode: r.requestCode, containerIds: r.containerIds };
	}
});

async function requestSummary(ctx: QueryCtx, r: Doc<'releaseRequests'>) {
	const containers = await ctx.db
		.query('containers')
		.withIndex('by_request', (q) => q.eq('requestId', r._id))
		.collect();
	const line = await ctx.db.get(r.lineOrgId);
	const importer = await ctx.db.get(r.importerOrgId);
	const byState: Record<string, number> = {};
	let deposit = 0n;
	let received = 0n;
	for (const c of containers) {
		byState[c.state] = (byState[c.state] ?? 0) + 1;
		deposit += u(c.depositUnits);
		received += u(c.receivedUnits ?? '0');
	}
	return {
		...r,
		lineName: line?.name ?? '',
		importerName: importer?.name ?? '',
		containerCount: containers.length,
		containerNumbers: containers.map((c) => c.number),
		byState,
		depositTotalUnits: deposit.toString(),
		receivedTotalUnits: received.toString()
	};
}

export const listForLine = query({
	args: { sessionToken: v.string() },
	handler: async (ctx, a) => {
		const { org } = await requireLine(ctx, a.sessionToken);
		const rows = await ctx.db
			.query('releaseRequests')
			.withIndex('by_line', (q) => q.eq('lineOrgId', org._id))
			.order('desc')
			.collect();
		return Promise.all(rows.map((r) => requestSummary(ctx, r)));
	}
});

export const listForImporter = query({
	args: { sessionToken: v.string() },
	handler: async (ctx, a) => {
		const s = await requireSession(ctx, a.sessionToken);
		if (s.org.kind !== 'importer') throw appError('FORBIDDEN', 'This list is for importers.');
		const rows = await ctx.db
			.query('releaseRequests')
			.withIndex('by_importer', (q) => q.eq('importerOrgId', s.org._id))
			.order('desc')
			.collect();
		return Promise.all(rows.map((r) => requestSummary(ctx, r)));
	}
});

/** One request with its containers, terms and totals. Visible to both parties only. */
export const get = query({
	args: {
		sessionToken: v.string(),
		requestId: v.optional(v.id('releaseRequests')),
		requestCode: v.optional(v.string())
	},
	handler: async (ctx, a) => {
		const s = await requireSession(ctx, a.sessionToken);
		let request: Doc<'releaseRequests'> | null = null;
		if (a.requestId) request = await ctx.db.get(a.requestId);
		else if (a.requestCode) {
			request = await ctx.db
				.query('releaseRequests')
				.withIndex('by_code', (q) => q.eq('requestCode', a.requestCode!.toUpperCase()))
				.first();
		}
		if (!request) return null;
		request = await loadRequestFor(ctx, s, request._id);
		const line = await ctx.db.get(request.lineOrgId);
		const importer = await ctx.db.get(request.importerOrgId);
		if (!line || !importer) return null;
		const rows = await ctx.db
			.query('containers')
			.withIndex('by_request', (q) => q.eq('requestId', request!._id))
			.collect();
		const cache = new Map<string, unknown>();
		const containers: ContainerView[] = [];
		for (const c of rows.sort((x, y) => x.seq - y.seq))
			containers.push(await containerView(ctx, c, cache));
		let deposit = 0n;
		let received = 0n;
		let covered = 0;
		let daily = 0n;
		for (const c of containers) {
			deposit += u(c.depositUnits);
			received += u(c.receivedUnits);
			daily += u(c.dailyRateUnits);
			if (c.covered || !['requested', 'awaiting_deposit'].includes(c.state)) covered++;
		}
		const payer = importer.tempoAddress ?? undefined;
		return {
			request,
			line: publicOrg(line),
			importer: publicOrg(importer),
			containers,
			terms: termsFor(line, request),
			totals: {
				depositUnits: deposit.toString(),
				receivedUnits: received.toString(),
				missingUnits: (deposit > received ? deposit - received : 0n).toString(),
				dailyRateUnits: daily.toString(),
				containersTotal: containers.length,
				containersCovered: covered
			},
			payerAddress: payer ?? null,
			balanceUnits: s.org.kind === 'importer' ? await simBalance(ctx, payer) : null
		};
	}
});

/** Line: issue the release order for every container that is covered (deposit held or key authorized). */
export const issueReleaseOrder = mutation({
	args: { sessionToken: v.string(), requestId: v.id('releaseRequests') },
	handler: async (ctx, a): Promise<ReleaseResult> => {
		const s = await requireLine(ctx, a.sessionToken);
		const request = await loadRequestFor(ctx, s, a.requestId);
		const r = await releaseRequestContainers(ctx, request._id, await productNow(ctx), s.user.name);
		if (r.released.length === 0 && r.blocked.length > 0) {
			throw appError('INVALID_STATE', r.blocked[0].reason, { blocked: r.blocked.length });
		}
		return r;
	}
});
