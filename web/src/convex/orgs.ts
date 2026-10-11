import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { appError, chainMode, productNow, requireImporter, requireLine } from './helpers';
import { provisionLine } from './orgSetup';
import { suggestedMode } from '../lib/shared/domain/rules';
import { DEFAULT_CLEAN_RETURNS_FOR_DEPOSIT_FREE, DEFAULT_MAX_DETENTION_DAYS, DEFAULT_SETTLEMENT_WINDOW_DAYS, DEFAULT_SILENT_GRACE_HOURS } from '../lib/shared/domain/constants';

/** Line: importers it can send release requests to, with track record and the suggested deposit mode. */
export const listImporters = query({
	args: { sessionToken: v.string() },
	handler: async (ctx, a) => {
		const { org: line } = await requireLine(ctx, a.sessionToken);
		const importers = await ctx.db
			.query('organizations')
			.withIndex('by_kind', (q) => q.eq('kind', 'importer'))
			.collect();
		const rels = await ctx.db
			.query('relationships')
			.withIndex('by_line', (q) => q.eq('lineOrgId', line._id))
			.collect();
		const disputes = await ctx.db
			.query('disputes')
			.withIndex('by_line_status', (q) => q.eq('lineOrgId', line._id).eq('status', 'open'))
			.collect();
		const containers = await ctx.db
			.query('containers')
			.withIndex('by_line', (q) => q.eq('lineOrgId', line._id))
			.collect();
		const threshold = line.cleanReturnsForDepositFree ?? DEFAULT_CLEAN_RETURNS_FOR_DEPOSIT_FREE;
		return importers
			.map((imp) => {
				const rel = rels.find((r) => r.importerOrgId === imp._id) ?? null;
				const openDisputes = disputes.filter((d) => d.importerOrgId === imp._id).length;
				const cleanReturns = rel?.cleanReturns ?? 0;
				const mine = containers.filter((c) => c.importerOrgId === imp._id);
				return {
					orgId: imp._id,
					name: imp.name,
					shortCode: imp.shortCode,
					country: imp.country,
					tempoAddress: imp.tempoAddress ?? null,
					relationship: rel
						? {
								defaultMode: rel.defaultMode,
								cleanReturns: rel.cleanReturns,
								lateReturns: rel.lateReturns,
								disputes: rel.disputes
							}
						: null,
					openDisputes,
					cleanReturnsForDepositFree: threshold,
					suggestedMode: suggestedMode({ cleanReturns, openDisputes, cleanReturnsForDepositFree: threshold }),
					activeContainers: mine.filter((c) => c.state !== 'settled').length,
					totalContainers: mine.length
				};
			})
			.sort((x, y) => x.name.localeCompare(y.name));
	}
});

/** Importer: the lines they have dealt with. */
export const listLines = query({
	args: { sessionToken: v.string() },
	handler: async (ctx, a) => {
		const { org } = await requireImporter(ctx, a.sessionToken);
		const rels = await ctx.db
			.query('relationships')
			.withIndex('by_importer', (q) => q.eq('importerOrgId', org._id))
			.collect();
		const out = [];
		for (const r of rels) {
			const line = await ctx.db.get(r.lineOrgId);
			if (!line) continue;
			out.push({
				orgId: line._id,
				name: line.name,
				shortCode: line.shortCode,
				country: line.country,
				defaultMode: r.defaultMode,
				cleanReturns: r.cleanReturns,
				lateReturns: r.lateReturns
			});
		}
		return out;
	}
});

export const lineSettings = query({
	args: { sessionToken: v.string() },
	handler: async (ctx, a) => {
		const { org } = await requireLine(ctx, a.sessionToken);
		const rateCards = await ctx.db
			.query('rateCards')
			.withIndex('by_line', (q) => q.eq('lineOrgId', org._id))
			.collect();
		const resolverId = org.resolverOrgId;
		const resolver = resolverId ? await ctx.db.get(resolverId) : null;
		const platforms = await ctx.db
			.query('organizations')
			.withIndex('by_kind', (q) => q.eq('kind', 'platform'))
			.collect();
		return {
			org,
			chainMode: chainMode(),
			settlementWindowDays: org.settlementWindowDays ?? DEFAULT_SETTLEMENT_WINDOW_DAYS,
			cleanReturnsForDepositFree: org.cleanReturnsForDepositFree ?? DEFAULT_CLEAN_RETURNS_FOR_DEPOSIT_FREE,
			maxDetentionDays: org.maxDetentionDays ?? DEFAULT_MAX_DETENTION_DAYS,
			silentGraceHours: org.silentGraceHours ?? DEFAULT_SILENT_GRACE_HOURS,
			depositsAccount: org.depositsAccount ?? null,
			chargesAddress: org.chargesAddress ?? null,
			settlementContract: org.settlementContract ?? null,
			masterId: org.masterId ?? null,
			masterRegistered: chainMode() === 'live' && org.masterId !== undefined,
			receivePolicy: org.receivePolicy ?? null,
			provisioned: Boolean(org.depositsAccount && org.settlementContract && org.masterId && org.receivePolicy),
			resolver: resolver ? { orgId: resolver._id, name: resolver.name } : null,
			resolverChoices: platforms.map((p) => ({ orgId: p._id, name: p.name })).concat([{ orgId: org._id, name: `${org.name} (the line itself)` }]),
			rateCards: rateCards.sort((x, y) => x.containerType.localeCompare(y.containerType))
		};
	}
});

export const updateLineSettings = mutation({
	args: {
		sessionToken: v.string(),
		settlementWindowDays: v.optional(v.number()),
		cleanReturnsForDepositFree: v.optional(v.number()),
		maxDetentionDays: v.optional(v.number()),
		silentGraceHours: v.optional(v.number()),
		resolverOrgId: v.optional(v.id('organizations')),
		chargesAddress: v.optional(v.string())
	},
	handler: async (ctx, a): Promise<null> => {
		const { org } = await requireLine(ctx, a.sessionToken);
		const patch: Record<string, number | string> = {};
		const int = (name: string, val: number | undefined, min: number, max: number) => {
			if (val === undefined) return;
			if (!Number.isInteger(val) || val < min || val > max) throw appError('INVALID', `${name} must be a whole number from ${min} to ${max}.`);
			patch[name] = val;
		};
		int('settlementWindowDays', a.settlementWindowDays, 1, 30);
		int('cleanReturnsForDepositFree', a.cleanReturnsForDepositFree, 1, 50);
		int('maxDetentionDays', a.maxDetentionDays, 1, 120);
		int('silentGraceHours', a.silentGraceHours, 0, 168);
		if (a.chargesAddress !== undefined) {
			if (!/^0x[0-9a-fA-F]{40}$/.test(a.chargesAddress)) throw appError('INVALID', 'The charges address is not valid.');
			patch.chargesAddress = a.chargesAddress.toLowerCase();
		}
		if (a.resolverOrgId !== undefined) {
			const r = await ctx.db.get(a.resolverOrgId);
			if (!r || (r.kind !== 'platform' && r._id !== org._id)) throw appError('INVALID', 'Pick the platform or the line itself as resolver.');
			patch.resolverOrgId = r._id;
		}
		await ctx.db.patch(org._id, patch);
		return null;
	}
});

/** Line: (re)apply the deposits-account setup: receive policy with the settlement contract as recovery authority. */
export const configureReceivePolicy = mutation({
	args: { sessionToken: v.string() },
	handler: async (ctx, a) => {
		const { org } = await requireLine(ctx, a.sessionToken);
		await provisionLine(ctx, org._id, await productNow(ctx));
		const fresh = await ctx.db.get(org._id);
		if (!fresh?.receivePolicy) {
			throw appError('NOT_SUPPORTED', 'This line is not provisioned on-chain yet. Run the live setup script (docs/LIVE-SETUP.md).');
		}
		return fresh.receivePolicy;
	}
});
