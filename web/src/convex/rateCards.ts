import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { containerType } from './schema';
import { appError, requireLine } from './helpers';

export const list = query({
	args: { sessionToken: v.string() },
	handler: async (ctx, a) => {
		const { org } = await requireLine(ctx, a.sessionToken);
		const cards = await ctx.db
			.query('rateCards')
			.withIndex('by_line', (q) => q.eq('lineOrgId', org._id))
			.collect();
		return cards.sort((x, y) => x.containerType.localeCompare(y.containerType));
	}
});

const units = (name: string, s: string): string => {
	if (!/^\d+$/.test(s) || BigInt(s) <= 0n)
		throw appError('INVALID', `${name} must be a positive amount in base units.`);
	return BigInt(s).toString();
};

export const upsert = mutation({
	args: {
		sessionToken: v.string(),
		containerType,
		freeDays: v.number(),
		dailyRateUnits: v.string(),
		depositUnits: v.string()
	},
	handler: async (ctx, a) => {
		const { org } = await requireLine(ctx, a.sessionToken);
		if (!Number.isInteger(a.freeDays) || a.freeDays < 0 || a.freeDays > 60)
			throw appError('INVALID', 'Free days must be a whole number from 0 to 60.');
		const dailyRateUnits = units('Daily rate', a.dailyRateUnits);
		const depositUnits = units('Deposit', a.depositUnits);
		const existing = await ctx.db
			.query('rateCards')
			.withIndex('by_line_type', (q) =>
				q.eq('lineOrgId', org._id).eq('containerType', a.containerType)
			)
			.first();
		if (existing) {
			await ctx.db.patch(existing._id, { freeDays: a.freeDays, dailyRateUnits, depositUnits });
			return { ...existing, freeDays: a.freeDays, dailyRateUnits, depositUnits };
		}
		const id = await ctx.db.insert('rateCards', {
			lineOrgId: org._id,
			containerType: a.containerType,
			freeDays: a.freeDays,
			dailyRateUnits,
			depositUnits
		});
		return (await ctx.db.get(id))!;
	}
});
