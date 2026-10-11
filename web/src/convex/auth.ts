import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { appError, demoEnabled, findSession, lc, randomHex } from './helpers';
import { fundSimImporter, insertDefaultRateCards, makeShortCode, provisionLine } from './orgSetup';
import { verifyAssertion } from './webauthn';

const SESSION_MS = 14 * 24 * 60 * 60 * 1000;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export function publicUser(u: Doc<'users'>) {
	return {
		_id: u._id,
		orgId: u.orgId,
		name: u.name,
		email: u.email ?? null,
		role: u.role,
		title: u.title ?? null,
		demo: u.demo,
		hasPasskey: u.passkey !== undefined,
		passkeyAddress: u.passkey?.address ?? null,
		credentialId: u.passkey?.credentialId ?? null
	};
}

async function createSession(ctx: MutationCtx, userId: Id<'users'>, extra: Partial<Doc<'sessions'>> = {}): Promise<string> {
	const token = randomHex(32);
	const now = Date.now();
	await ctx.db.insert('sessions', { token, userId, createdAt: now, expiresAt: now + SESSION_MS, ...extra });
	return token;
}

/** Public: a one-time server challenge for passkey sign-in. */
export const createChallenge = mutation({
	args: {},
	handler: async (ctx): Promise<{ challenge: string }> => {
		const challenge = `0x${randomHex(32)}`;
		await ctx.db.insert('challenges', { challenge, createdAt: Date.now(), used: false });
		return { challenge };
	}
});

/** Public: create an account (user + organization) from a new passkey and sign in. */
export const registerPasskey = mutation({
	args: {
		name: v.string(),
		email: v.optional(v.string()),
		orgName: v.string(),
		orgKind: v.union(v.literal('line'), v.literal('importer')),
		country: v.string(),
		credentialId: v.string(),
		publicKey: v.string(),
		address: v.string()
	},
	handler: async (ctx, a): Promise<{ sessionToken: string }> => {
		const name = a.name.trim();
		const orgName = a.orgName.trim();
		if (!name || !orgName) throw appError('INVALID', 'Enter your name and your organization.');
		if (!/^0x[0-9a-fA-F]{40}$/.test(a.address)) throw appError('INVALID', 'The passkey address is not valid.');
		if (!/^(0x)?[0-9a-fA-F]{128}$/.test(a.publicKey)) throw appError('INVALID', 'The passkey public key is not valid.');
		const existing = await ctx.db
			.query('users')
			.withIndex('by_credential', (q) => q.eq('credentialId', a.credentialId))
			.first();
		if (existing) throw appError('CONFLICT', 'This passkey is already registered. Sign in instead.');
		const now = Date.now();
		const shortCode = await makeShortCode(ctx, orgName);
		const orgId = await ctx.db.insert('organizations', {
			kind: a.orgKind,
			name: orgName,
			shortCode,
			country: a.country.trim() || 'Unknown',
			tempoAddress: a.orgKind === 'importer' ? lc(a.address) : undefined,
			containerPrefix: a.orgKind === 'line' ? `${shortCode.slice(0, 3)}U` : undefined,
			createdAt: now
		});
		if (a.orgKind === 'line') {
			await provisionLine(ctx, orgId, now);
			await insertDefaultRateCards(ctx, orgId);
		} else {
			await fundSimImporter(ctx, a.address);
		}
		const userId = await ctx.db.insert('users', {
			orgId,
			name,
			email: a.email?.trim() || undefined,
			role: a.orgKind,
			demo: false,
			credentialId: a.credentialId,
			passkey: {
				credentialId: a.credentialId,
				publicKey: a.publicKey.startsWith('0x') ? a.publicKey : `0x${a.publicKey}`,
				address: lc(a.address)
			},
			createdAt: now
		});
		return { sessionToken: await createSession(ctx, userId, { approvedWith: 'passkey', verified: true }) };
	}
});

/**
 * Public: sign in with a passkey assertion over a server challenge. The assertion is verified
 * with `WebAuthnP256.verify` against the public key stored at registration.
 */
export const signInWithPasskey = mutation({
	args: {
		credentialId: v.string(),
		challenge: v.string(),
		authenticatorData: v.string(),
		clientDataJSON: v.string(),
		signatureR: v.string(),
		signatureS: v.string(),
		userVerificationRequired: v.optional(v.boolean())
	},
	handler: async (ctx, a): Promise<{ sessionToken: string; verified: boolean }> => {
		const user = await ctx.db
			.query('users')
			.withIndex('by_credential', (q) => q.eq('credentialId', a.credentialId))
			.first();
		if (!user || !user.passkey) throw appError('UNAUTHENTICATED', 'We do not recognise this passkey. Create an account first.');
		const ch = await ctx.db
			.query('challenges')
			.withIndex('by_challenge', (q) => q.eq('challenge', a.challenge))
			.first();
		if (!ch || ch.used || Date.now() - ch.createdAt > CHALLENGE_TTL_MS) {
			throw appError('UNAUTHENTICATED', 'The sign-in challenge expired. Try again.');
		}
		let verified = false;
		try {
			verified = verifyAssertion({
				publicKeyHex: user.passkey.publicKey,
				challenge: a.challenge,
				assertion: {
					authenticatorData: a.authenticatorData,
					clientDataJSON: a.clientDataJSON,
					signatureR: a.signatureR,
					signatureS: a.signatureS,
					userVerificationRequired: a.userVerificationRequired
				}
			});
		} catch {
			verified = false;
		}
		if (!verified) throw appError('UNAUTHENTICATED', 'The passkey signature could not be verified.');
		await ctx.db.patch(ch._id, { used: true });
		return { sessionToken: await createSession(ctx, user._id, { approvedWith: 'passkey', verified: true }), verified };
	}
});

/** Public query: the public key stored for a credential id (used by WebAuthnP256.getCredential). */
export const passkeyPublicKey = query({
	args: { credentialId: v.string() },
	handler: async (ctx, a): Promise<string | null> => {
		const user = await ctx.db
			.query('users')
			.withIndex('by_credential', (q) => q.eq('credentialId', a.credentialId))
			.first();
		return user?.passkey?.publicKey ?? null;
	}
});

export const listDemoPersonas = query({
	args: {},
	handler: async (ctx) => {
		if (!demoEnabled()) return [];
		const users = await ctx.db
			.query('users')
			.withIndex('by_demo', (q) => q.eq('demo', true))
			.collect();
		const out = [];
		for (const u of users) {
			const org = await ctx.db.get(u.orgId);
			if (!org) continue;
			out.push({
				userId: u._id,
				name: u.name,
				title: u.title ?? '',
				orgName: org.name,
				orgKind: org.kind,
				country: org.country,
				blurb: u.blurb ?? org.blurb ?? ''
			});
		}
		const order = { line: 0, importer: 1, platform: 2 } as const;
		return out.sort((x, y) => order[x.orgKind] - order[y.orgKind] || x.orgName.localeCompare(y.orgName));
	}
});

export const signInAsDemo = mutation({
	args: { userId: v.id('users') },
	handler: async (ctx, a): Promise<{ sessionToken: string }> => {
		if (!demoEnabled()) throw appError('DEMO_DISABLED', 'Demo sign-in is turned off.');
		const user = await ctx.db.get(a.userId);
		if (!user || !user.demo) throw appError('NOT_FOUND', 'That demo persona does not exist.');
		return { sessionToken: await createSession(ctx, user._id, { approvedWith: 'demo', verified: false }) };
	}
});

export const me = query({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, a) => {
		const s = await findSession(ctx, a.sessionToken);
		if (!s) return null;
		return { user: publicUser(s.user), org: s.org, approvedWith: s.session.approvedWith ?? null, verified: s.session.verified ?? false };
	}
});

export const signOut = mutation({
	args: { sessionToken: v.string() },
	handler: async (ctx, a): Promise<null> => {
		const s = await ctx.db
			.query('sessions')
			.withIndex('by_token', (q) => q.eq('token', a.sessionToken))
			.unique();
		if (s) await ctx.db.delete(s._id);
		return null;
	}
});
