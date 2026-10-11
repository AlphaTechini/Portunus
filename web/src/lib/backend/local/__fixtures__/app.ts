import {
	anyApi,
	actionGeneric as action,
	internalMutationGeneric as internalMutation,
	mutationGeneric as mutation,
	queryGeneric as query
} from 'convex/server';
import { ConvexError, v } from 'convex/values';

const internal = anyApi;

export const listItems = query({
	args: { tag: v.optional(v.string()) },
	handler: async (ctx, args) => {
		if (args.tag !== undefined) {
			return await ctx.db
				.query('items')
				.withIndex('by_tag', (q) => q.eq('tag', args.tag))
				.collect();
		}
		return await ctx.db.query('items').collect();
	}
});

export const getItem = query({
	args: { id: v.id('items') },
	handler: async (ctx, args) => ctx.db.get(args.id)
});

export const countLogs = query({
	args: {},
	handler: async (ctx) => (await ctx.db.query('logs').collect()).length
});

export const addItem = mutation({
	args: { title: v.string(), qty: v.number(), tag: v.optional(v.string()) },
	handler: async (ctx, args) => {
		return await ctx.db.insert('items', args);
	}
});

export const failAfterWrite = mutation({
	args: {},
	handler: async (ctx) => {
		await ctx.db.insert('logs', { msg: 'should be rolled back' });
		throw new ConvexError({ code: 'NOPE', message: 'Nope, not allowed' });
	}
});

export const incr = mutation({
	args: { name: v.string() },
	handler: async (ctx, { name }) => {
		const c = await ctx.db
			.query('counters')
			.withIndex('by_name', (q) => q.eq('name', name))
			.unique();
		// yield so concurrent calls would interleave if they were not serialized
		await new Promise((r) => setTimeout(r, 1));
		if (!c) return await ctx.db.insert('counters', { name, value: 1 });
		await ctx.db.patch(c._id, { value: c.value + 1 });
		return c._id;
	}
});

export const nested = mutation({
	args: {},
	handler: async (ctx) => {
		await ctx.runMutation(anyApi.app.addItem, { title: 'outer-ok', qty: 1 });
		try {
			await ctx.runMutation(anyApi.app.failAfterWrite, {});
		} catch (e) {
			if (!(e instanceof ConvexError)) throw e;
		}
		const items = await ctx.runQuery(anyApi.app.listItems, {});
		return items.length;
	}
});

export const scheduleLog = mutation({
	args: { delayMs: v.number(), msg: v.string() },
	handler: async (ctx, { delayMs, msg }) => {
		return await ctx.scheduler.runAfter(delayMs, internal.app.writeLog, { msg });
	}
});

export const scheduleThenFail = mutation({
	args: {},
	handler: async (ctx) => {
		await ctx.scheduler.runAfter(0, internal.app.writeLog, { msg: 'ghost' });
		throw new Error('boom');
	}
});

export const cancelJob = mutation({
	args: { id: v.id('_scheduled_functions') },
	handler: async (ctx, { id }) => ctx.scheduler.cancel(id)
});

export const writeLog = internalMutation({
	args: { msg: v.string() },
	handler: async (ctx, { msg }) => {
		await ctx.db.insert('logs', { msg });
	}
});

export const cronTick = internalMutation({
	args: {},
	handler: async (ctx) => {
		await ctx.db.insert('logs', { msg: 'cron' });
	}
});

export const slowAction = action({
	args: { n: v.number() },
	handler: async (ctx, { n }) => {
		await new Promise((r) => setTimeout(r, 5));
		for (let i = 0; i < n; i++) {
			await ctx.runMutation(anyApi.app.addItem, { title: `act-${i}`, qty: i });
		}
		await ctx.scheduler.runAfter(0, internal.app.writeLog, { msg: 'from-action' });
		const items = await ctx.runQuery(anyApi.app.listItems, {});
		return items.length;
	}
});

export const failingAction = action({
	args: {},
	handler: async () => {
		throw new ConvexError({ code: 'ACTION_FAIL', message: 'action failed' });
	}
});

export const secretInternal = internalMutation({
	args: {},
	handler: async () => 'secret'
});
