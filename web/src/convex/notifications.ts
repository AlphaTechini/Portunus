import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireSession } from './helpers';

export const list = query({
	args: {
		sessionToken: v.string(),
		limit: v.optional(v.number()),
		unreadOnly: v.optional(v.boolean())
	},
	handler: async (ctx, a) => {
		const s = await requireSession(ctx, a.sessionToken);
		const rows = await ctx.db
			.query('notifications')
			.withIndex('by_org', (q) => q.eq('orgId', s.org._id))
			.order('desc')
			.collect();
		let mine = rows.filter((n) => !n.userId || n.userId === s.user._id);
		const unread = mine.filter((n) => n.readAt === undefined).length;
		if (a.unreadOnly) mine = mine.filter((n) => n.readAt === undefined);
		mine = mine.sort((x, y) => y.createdAt - x.createdAt).slice(0, Math.min(a.limit ?? 50, 200));
		return { unread, items: mine };
	}
});

/** Mark the given notifications (or all, when `ids` is omitted) as read. */
export const markRead = mutation({
	args: { sessionToken: v.string(), ids: v.optional(v.array(v.id('notifications'))) },
	handler: async (ctx, a): Promise<{ marked: number }> => {
		const s = await requireSession(ctx, a.sessionToken);
		const now = Date.now();
		let marked = 0;
		if (a.ids) {
			for (const id of a.ids) {
				const n = await ctx.db.get(id);
				if (n && n.orgId === s.org._id && n.readAt === undefined) {
					await ctx.db.patch(id, { readAt: now });
					marked++;
				}
			}
		} else {
			const rows = await ctx.db
				.query('notifications')
				.withIndex('by_org', (q) => q.eq('orgId', s.org._id))
				.collect();
			for (const n of rows) {
				if (n.readAt === undefined) {
					await ctx.db.patch(n._id, { readAt: now });
					marked++;
				}
			}
		}
		return { marked };
	}
});
