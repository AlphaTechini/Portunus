/**
 * Deposit-free mode. The importer authorizes a fresh access key per container: one day's
 * detention per day, payable only to the line's charges address, expiring after the maximum
 * detention days. No money moves. Only the importer root key can revoke.
 */
import { v } from 'convex/values';
import { keccak256, stringToHex } from 'viem';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { action, internalMutation, internalQuery, type QueryCtx } from './_generated/server';
import { appError, chainMode, lc, loadContainerFor, loadRequestFor, productNow, requireImporter, type Approval, type SessionInfo } from './helpers';
import { chainAuthorizeKey, chainCreateAccessKey, chainKeyState, chainRevokeKey } from './chain';
import { insertPreparedKey, keyTerms, plannedKeyExpiry, recordKeyAuthorizedOp, recordKeyRevokedOp, type KeyTerms } from './opsKeys';
import { approvalV, checkApproval } from './webauthn';
import { stableJson } from '../lib/shared/tempo/sim';
import type { TxResultJson } from '../lib/shared/tempo/adapter';

export interface PrepareResult {
	requestId: Id<'releaseRequests'>;
	mode: 'sim' | 'live';
	payloadHash: string;
	/** Per container: what the importer is about to authorize. */
	keys: KeyTerms[];
}

function payloadFor(requestId: Id<'releaseRequests'>, keys: KeyTerms[]): string {
	return keccak256(
		stringToHex(
			stableJson({
				requestId,
				keys: keys.map((k) => ({
					c: k.containerId,
					key: k.keyAddress,
					limit: k.dailyLimitUnits,
					to: k.recipient,
					expiry: k.expiry
				}))
			})
		)
	);
}

function payerAddress(s: SessionInfo): string {
	return lc(s.user.passkey?.address ?? s.org.tempoAddress ?? '');
}

async function loadPrepareState(ctx: QueryCtx, s: SessionInfo, requestId: Id<'releaseRequests'>) {
	const request = await loadRequestFor(ctx, s, requestId);
	if (request.mode !== 'depositFree') throw appError('NOT_SUPPORTED', 'This request uses held deposits. Pay the deposits instead.');
	const line = await ctx.db.get(request.lineOrgId);
	if (!line) throw appError('NOT_FOUND', 'Line not found.');
	const containers = (
		await ctx.db
			.query('containers')
			.withIndex('by_request', (q) => q.eq('requestId', request._id))
			.collect()
	).sort((x, y) => x.seq - y.seq);
	const rows: { container: Doc<'containers'>; key: Doc<'accessKeys'> | null }[] = [];
	for (const c of containers) {
		const key = await ctx.db
			.query('accessKeys')
			.withIndex('by_container', (q) => q.eq('containerId', c._id))
			.first();
		rows.push({ container: c, key });
	}
	return { request, line, rows };
}

/** Internal: which containers still need a key, and the keys already prepared. */
export const loadForPrepare = internalQuery({
	args: { sessionToken: v.string(), requestId: v.id('releaseRequests') },
	handler: async (ctx, a): Promise<{ needKeys: Id<'containers'>[]; account: string }> => {
		const s = await requireImporter(ctx, a.sessionToken);
		const account = payerAddress(s);
		if (!account) throw appError('INVALID', 'Your account has no Tempo address yet.');
		const { rows } = await loadPrepareState(ctx, s, a.requestId);
		const needKeys = rows.filter((r) => r.container.state === 'requested' && !r.key).map((r) => r.container._id);
		return { needKeys, account };
	}
});

export const storePrepared = internalMutation({
	args: {
		sessionToken: v.string(),
		requestId: v.id('releaseRequests'),
		keys: v.array(v.object({ containerId: v.id('containers'), keyAddress: v.string(), encPrivKey: v.string() })),
		account: v.string()
	},
	handler: async (ctx, a): Promise<PrepareResult> => {
		const s = await requireImporter(ctx, a.sessionToken);
		const now = await productNow(ctx);
		const { request, line, rows } = await loadPrepareState(ctx, s, a.requestId);
		for (const k of a.keys) {
			const row = rows.find((r) => r.container._id === k.containerId);
			if (!row || row.key || row.container.state !== 'requested') continue; // lost a race: keep the existing key
			await insertPreparedKey(ctx, {
				container: row.container,
				line,
				account: a.account,
				keyAddress: k.keyAddress,
				encPrivKey: k.encPrivKey,
				mode: chainMode(),
				now
			});
		}
		const fresh = await loadPrepareState(ctx, s, a.requestId);
		const keys: KeyTerms[] = [];
		for (const r of fresh.rows) {
			if (!r.key || r.key.status !== 'prepared') continue;
			const expiry = plannedKeyExpiry(r.container, now);
			if (expiry !== r.key.expiry) await ctx.db.patch(r.key._id, { expiry, preparedAt: now });
			keys.push(keyTerms({ ...r.key, expiry }, r.container.number));
		}
		return { requestId: request._id, mode: chainMode(), payloadHash: payloadFor(request._id, keys), keys };
	}
});

/**
 * Importer: create (or reuse) one access key per container awaiting authorization and return the
 * terms to review: daily cap, recipient, expiry. The browser only ever sees the key ADDRESS.
 */
export const prepare = action({
	args: { sessionToken: v.string(), requestId: v.id('releaseRequests') },
	handler: async (ctx, a): Promise<PrepareResult> => {
		const { needKeys, account } = await ctx.runQuery(internal.accessKeys.loadForPrepare, a);
		const created: { containerId: Id<'containers'>; keyAddress: string; encPrivKey: string }[] = [];
		for (const containerId of needKeys) {
			const k = await chainCreateAccessKey(ctx);
			if (!k.ok) throw appError('CHAIN_ERROR', k.error.message, { name: k.error.name });
			created.push({ containerId, keyAddress: k.keyAddress, encPrivKey: k.encPrivKey });
		}
		return ctx.runMutation(internal.accessKeys.storePrepared, { ...a, keys: created, account });
	}
});

export const authPlan = internalQuery({
	args: { sessionToken: v.string(), requestId: v.id('releaseRequests'), approval: approvalV },
	handler: async (
		ctx,
		a
	): Promise<{ payloadHash: string; approvedWith: 'passkey' | 'demo'; items: { keyId: Id<'accessKeys'>; terms: KeyTerms }[] }> => {
		const s = await requireImporter(ctx, a.sessionToken);
		const { request, rows } = await loadPrepareState(ctx, s, a.requestId);
		const items = rows
			.filter((r) => r.key && r.key.status === 'prepared')
			.map((r) => ({ keyId: r.key!._id, terms: keyTerms(r.key!, r.container.number) }));
		if (items.length === 0) throw appError('INVALID_STATE', 'There is nothing left to authorize on this request.');
		const payloadHash = payloadFor(request._id, items.map((i) => i.terms));
		const { approvedWith } = checkApproval(s.user, a.approval as Approval, payloadHash);
		return { payloadHash, approvedWith, items };
	}
});

export const recordAuthorized = internalMutation({
	args: {
		keyId: v.id('accessKeys'),
		tx: v.any(),
		approvedWith: v.union(v.literal('passkey'), v.literal('demo')),
		actor: v.string()
	},
	handler: async (ctx, a): Promise<null> => {
		await recordKeyAuthorizedOp(ctx, {
			keyId: a.keyId,
			tx: a.tx as TxResultJson,
			now: await productNow(ctx),
			approvedWith: a.approvedWith,
			actor: a.actor
		});
		return null;
	}
});

export interface AuthorizeResult {
	requestId: Id<'releaseRequests'>;
	authorized: {
		containerId: Id<'containers'>;
		number: string;
		keyAddress: string;
		dailyLimitUnits: string;
		recipient: string;
		expiry: number;
		txHash: string;
		finalityMs: number;
	}[];
	failed: { containerId: Id<'containers'>; number: string; error: string }[];
}

/**
 * Importer: approve the access keys. No money moves. Sim: the keychain records each key.
 * Live: the browser already submitted `authorizeSync`; pass the tx hashes in `liveTxHashes` and the
 * server verifies the key on-chain before recording it.
 */
export const authorize = action({
	args: {
		sessionToken: v.string(),
		requestId: v.id('releaseRequests'),
		approval: approvalV,
		liveTxHashes: v.optional(v.array(v.object({ containerId: v.id('containers'), txHash: v.string() })))
	},
	handler: async (ctx, a): Promise<AuthorizeResult> => {
		const plan = await ctx.runQuery(internal.accessKeys.authPlan, {
			sessionToken: a.sessionToken,
			requestId: a.requestId,
			approval: a.approval
		});
		const me = await ctx.runQuery(internal.auth_internal.actorName, { sessionToken: a.sessionToken });
		const out: AuthorizeResult = { requestId: a.requestId, authorized: [], failed: [] };
		const now = await ctx.runQuery(internal.deposits.clock, {});
		for (const item of plan.items) {
			const t = item.terms;
			let tx: TxResultJson | null = null;
			let error: string | null = null;
			if (chainMode() === 'live') {
				const hash = a.liveTxHashes?.find((h) => h.containerId === t.containerId)?.txHash;
				const st = await chainKeyState(ctx, { account: t.account, keyAddress: t.keyAddress });
				if (!hash) error = 'Missing the authorization transaction hash.';
				else if (!st.ok) error = st.error.message;
				else if (!st.exists || st.isRevoked) error = 'The access key is not authorized on-chain.';
				else
					tx = {
						mode: 'live',
						txHash: hash as `0x${string}`,
						blockNumber: '0',
						timestamp: Date.now(),
						explorerUrl: null,
						finalityMs: 0
					};
			} else {
				const r = await chainAuthorizeKey(ctx, {
					account: t.account,
					keyAddress: t.keyAddress,
					limitUnits: t.dailyLimitUnits,
					periodSec: t.periodSec,
					recipient: t.recipient,
					expiry: t.expiry,
					at: now
				});
				if (r.ok) tx = r.tx;
				else error = r.error.message;
			}
			if (!tx) {
				out.failed.push({ containerId: t.containerId, number: t.number, error: error ?? 'Authorization failed.' });
				continue;
			}
			await ctx.runMutation(internal.accessKeys.recordAuthorized, {
				keyId: item.keyId,
				tx,
				approvedWith: plan.approvedWith,
				actor: me
			});
			out.authorized.push({
				containerId: t.containerId,
				number: t.number,
				keyAddress: t.keyAddress,
				dailyLimitUnits: t.dailyLimitUnits,
				recipient: t.recipient,
				expiry: t.expiry,
				txHash: tx.txHash,
				finalityMs: tx.finalityMs
			});
		}
		if (out.authorized.length === 0 && out.failed.length > 0) {
			throw appError('CHAIN_ERROR', out.failed[0].error);
		}
		return out;
	}
});

export const revokePlan = internalQuery({
	args: { sessionToken: v.string(), containerId: v.id('containers') },
	handler: async (
		ctx,
		a
	): Promise<{ keyId: Id<'accessKeys'>; account: string; keyAddress: string; actor: string; midFlight: boolean }> => {
		const s = await requireImporter(ctx, a.sessionToken);
		const c = await loadContainerFor(ctx, s, a.containerId);
		const key = await ctx.db
			.query('accessKeys')
			.withIndex('by_container', (q) => q.eq('containerId', c._id))
			.first();
		if (!key || key.status === 'prepared') throw appError('INVALID_STATE', 'There is no authorized access key for this container.');
		if (key.status === 'revoked') throw appError('INVALID_STATE', 'This access key is already revoked.');
		return {
			keyId: key._id,
			account: key.account,
			keyAddress: key.keyAddress,
			actor: s.user.name,
			midFlight: !['settled', 'settling', 'returned'].includes(c.state)
		};
	}
});

export const recordRevoked = internalMutation({
	args: { keyId: v.id('accessKeys'), tx: v.any(), actor: v.string() },
	handler: async (ctx, a): Promise<null> => {
		await recordKeyRevokedOp(ctx, {
			keyId: a.keyId,
			tx: (a.tx as TxResultJson | null) ?? null,
			now: await productNow(ctx),
			by: 'importer',
			actor: a.actor
		});
		return null;
	}
});

/**
 * Importer: revoke the access key with the root key. Allowed at any time (the line keeps the
 * detention already pulled; later days become uncollected exposure). Live: submit `revokeSync` in the
 * browser first; the server then verifies the key is revoked on-chain.
 */
export const revoke = action({
	args: { sessionToken: v.string(), containerId: v.id('containers') },
	handler: async (ctx, a): Promise<{ revoked: true; txHash: string | null; midFlight: boolean }> => {
		const plan = await ctx.runQuery(internal.accessKeys.revokePlan, a);
		const now = await ctx.runQuery(internal.deposits.clock, {});
		const r = await chainRevokeKey(ctx, { account: plan.account, keyAddress: plan.keyAddress, at: now });
		if (!r.ok) throw appError('CHAIN_ERROR', r.error.message, { name: r.error.name });
		await ctx.runMutation(internal.accessKeys.recordRevoked, { keyId: plan.keyId, tx: r.tx, actor: plan.actor });
		return { revoked: true, txHash: r.tx?.txHash ?? null, midFlight: plan.midFlight };
	}
});
