import { v } from 'convex/values';
import { internalQuery } from './_generated/server';
import { requireSession } from './helpers';

/** Display name of the signed-in user, for the timeline ("Issued by ..."). */
export const actorName = internalQuery({
	args: { sessionToken: v.string() },
	handler: async (ctx, a): Promise<string> => (await requireSession(ctx, a.sessionToken)).user.name
});
