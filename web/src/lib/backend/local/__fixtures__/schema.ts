import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
	items: defineTable({
		title: v.string(),
		qty: v.number(),
		tag: v.optional(v.string()),
		meta: v.optional(v.object({ note: v.string() }))
	})
		.index('by_tag', ['tag'])
		.index('by_qty', ['qty'])
		.index('by_tag_qty', ['tag', 'qty']),
	counters: defineTable({ name: v.string(), value: v.number() }).index('by_name', ['name']),
	logs: defineTable({ msg: v.string() })
});
