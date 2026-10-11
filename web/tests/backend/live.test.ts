import { afterEach, describe, expect, it, vi } from 'vitest';
import { v } from 'convex/values';
import { keccak256 } from 'viem';
import { ReceivePolicyReceipt } from 'viem/tempo';
import { internalAction } from '../../src/convex/_generated/server';
import { api, internal, DAY, demoApproval, newBackend, orgId, newRequest, signIn } from './setup';
import { ALPHA_USD } from '../../src/lib/shared/domain/constants';
import { encodeMemo } from '../../src/lib/shared/domain/memo';
import { toUnits } from '../../src/lib/shared/domain/money';

afterEach(() => {
	vi.useRealTimers();
	process.env.TEMPO_MODE = 'sim';
});

/** A stand-in for src/convex/tempoNode.ts (which needs the network): records calls, returns canned data. */
const calls: { name: string; args: Record<string, unknown> }[] = [];
const stub = {
	confirm: [] as unknown[],
	keyState: { remainingUnits: '45000000', periodEnd: 0, expiry: 0, isRevoked: false } as Record<
		string,
		unknown
	>,
	pulls: [] as unknown[]
};
const rec = (name: string, args: Record<string, unknown>) => calls.push({ name, args });
const tx = (hash: string) => ({
	mode: 'live' as const,
	txHash: hash,
	blockNumber: '777',
	timestamp: Date.now(),
	explorerUrl: `https://explore.testnet.tempo.xyz/tx/${hash}`,
	finalityMs: 540
});
const tempoNodeStub = async () => ({
	confirmDeposits: internalAction({
		args: { txHash: v.string(), depositsAccount: v.optional(v.string()) },
		handler: async (_c, a) => {
			rec('confirmDeposits', a);
			return stub.confirm;
		}
	}),
	createAccessKey: internalAction({
		args: {},
		handler: async () => {
			rec('createAccessKey', {});
			return { keyAddress: `0x${'ab'.repeat(20)}`, encPrivKey: 'enc:secret' };
		}
	}),
	getAccessKeyState: internalAction({
		args: { account: v.string(), keyAddress: v.string(), token: v.optional(v.string()) },
		handler: async (_c, a) => {
			rec('getAccessKeyState', a);
			return stub.keyState;
		}
	}),
	pullDetention: internalAction({
		args: {
			account: v.string(),
			encPrivKey: v.string(),
			to: v.string(),
			amountUnits: v.string(),
			memo: v.string()
		},
		handler: async (_c, a) => {
			rec('pullDetention', a);
			return stub.pulls.shift() ?? tx(`0x${'0d'.repeat(32)}`);
		}
	}),
	settle: internalAction({
		args: {
			items: v.array(
				v.object({
					receipt: v.string(),
					chargeUnits: v.string(),
					disputedUnits: v.string(),
					chargeMemo: v.string(),
					refundMemo: v.string()
				})
			)
		},
		handler: async (_c, a) => {
			rec('settle', a);
			return tx(`0x${'5e'.repeat(32)}`);
		}
	}),
	listHeldReceipts: internalAction({
		args: { depositsAccount: v.string(), fromBlock: v.string() },
		handler: async (_c, a) => {
			rec('listHeldReceipts', a);
			return { receipts: [], toBlock: '900', headBlock: '900' };
		}
	})
});

function heldReceipt(args: {
	recipient: string;
	originator: string;
	amount: bigint;
	txHash: string;
	settlement: string;
}) {
	const memo = encodeMemo('PD LIVE TEST');
	const receipt = ReceivePolicyReceipt.encode({
		version: 1,
		token: ALPHA_USD,
		recoveryAuthority: args.settlement as `0x${string}`,
		originator: args.originator as `0x${string}`,
		recipient: args.recipient as `0x${string}`,
		blockedAt: BigInt(Math.floor(Date.now() / 1000)),
		blockedNonce: 1n,
		blockedReason: 'receivePolicy',
		kind: 'transfer',
		memo
	});
	return {
		id: keccak256(receipt),
		receipt,
		token: ALPHA_USD,
		amount: args.amount.toString(),
		originator: args.originator,
		recipient: args.recipient,
		blockedAt: Date.now(),
		memo,
		blockedReason: 'receivePolicy' as const,
		txHash: args.txHash,
		logIndex: 4
	};
}

describe('live branch (tempoNode stubbed)', () => {
	it('records a browser-submitted batch, settles through tempoNode.settle and links the explorer', async () => {
		vi.useFakeTimers();
		calls.length = 0;
		const t = newBackend({ '../../src/convex/tempoNode.ts': tempoNodeStub });
		await t.mutation(api.seed.ensure, {});
		const adaeze = await signIn(t, 'Adaeze Okafor');
		const tunde = await signIn(t, 'Tunde Bakare');
		const r = await newRequest(t, adaeze, await orgId(t, 'Harbourview Foods Ltd'), ['20GP']);
		const info = await t.run(async (ctx) => {
			const c = (await ctx.db.get(r.containerIds[0]))!;
			const imp = (await ctx.db.get(c.importerOrgId))!;
			const line = (await ctx.db.get(c.lineOrgId))!;
			return {
				to: c.depositAddress,
				from: imp.tempoAddress!,
				settlement: line.settlementContract!
			};
		});

		process.env.TEMPO_MODE = 'live';
		await expect(
			t.action(api.deposits.payBatch, {
				sessionToken: tunde,
				requestId: r.requestId,
				approval: demoApproval
			})
		).rejects.toThrow(/NOT_SUPPORTED/);
		const txHash = `0x${'a1'.repeat(32)}`;
		stub.confirm = [
			heldReceipt({
				recipient: info.to,
				originator: info.from,
				amount: toUnits('1200'),
				txHash,
				settlement: info.settlement
			})
		];
		const rec1 = await t.action(api.deposits.recordLiveBatch, {
			sessionToken: tunde,
			requestId: r.requestId,
			txHash
		});
		expect(rec1.allCovered).toBe(true);
		expect(rec1.mode).toBe('live');
		expect(calls.find((c) => c.name === 'confirmDeposits')!.args.txHash).toBe(txHash);
		// Recording the same transaction twice does not double count.
		await t.action(api.deposits.recordLiveBatch, {
			sessionToken: tunde,
			requestId: r.requestId,
			txHash
		});
		const once = await t.query(api.containers.get, {
			sessionToken: tunde,
			containerId: r.containerIds[0]
		});
		expect(once.container.receivedUnits).toBe(toUnits('1200').toString());
		expect(once.payments.filter((p) => p.kind === 'deposit')).toHaveLength(1);
		expect(once.payments[0]).toMatchObject({
			mode: 'live',
			explorerUrl: `https://explore.testnet.tempo.xyz/tx/${txHash}`
		});

		await t.mutation(api.releaseRequests.issueReleaseOrder, {
			sessionToken: adaeze,
			requestId: r.requestId
		});
		vi.setSystemTime(Date.now() + 8 * DAY + 3_600_000); // live: the real clock
		await t.mutation(api.containers.recordReturn, {
			sessionToken: adaeze,
			containerId: r.containerIds[0],
			eirNumber: 'EIR-LIVE-1',
			depot: 'Apapa'
		});
		const done = await t.action(api.containers.postCharges, {
			sessionToken: adaeze,
			containerId: r.containerIds[0]
		});
		expect(done.status).toBe('settled');
		expect(done.chargeUnits).toBe(toUnits('90').toString()); // 2 started days x 45.00
		const settleCall = calls.find((c) => c.name === 'settle')!;
		const item = (settleCall.args.items as Record<string, string>[])[0];
		expect(item.receipt).toBe(stub.confirm[0] && (stub.confirm[0] as { receipt: string }).receipt);
		expect(item.chargeUnits).toBe(toUnits('90').toString());
		expect(item.chargeMemo).toBe(encodeMemo('PS ' + once.container.number + ' EIR-LIVE-1'));
		const fin = await t.query(api.containers.get, {
			sessionToken: tunde,
			containerId: r.containerIds[0]
		});
		const refund = fin.payments.find((p) => p.kind === 'refund')!;
		expect(refund).toMatchObject({
			mode: 'live',
			amountUnits: toUnits('1110').toString(),
			txHash: `0x${'5e'.repeat(32)}`
		});
		expect(refund.explorerUrl).toContain('explore.testnet.tempo.xyz');
	});

	it('deposit-free: authorizes after verifying the key on-chain, pulls via the node, maps the chain refusal, asks the importer to revoke', async () => {
		vi.useFakeTimers();
		calls.length = 0;
		const t = newBackend({ '../../src/convex/tempoNode.ts': tempoNodeStub });
		await t.mutation(api.seed.ensure, {});
		const adaeze = await signIn(t, 'Adaeze Okafor');
		const wanjiru = await signIn(t, 'Wanjiru Mwangi');
		const savanna = await orgId(t, 'Savanna Agro Traders');
		process.env.TEMPO_MODE = 'live';
		const r = await newRequest(t, adaeze, savanna, ['20GP'], 'depositFree');
		const prep = await t.action(api.accessKeys.prepare, {
			sessionToken: wanjiru,
			requestId: r.requestId
		});
		expect(prep.keys[0].keyAddress).toBe(`0x${'ab'.repeat(20)}`);
		expect(JSON.stringify(prep)).not.toContain('enc:secret'); // the private key never reaches the browser

		const authTx = `0x${'cc'.repeat(32)}`;
		// not authorized on-chain yet: refused
		stub.keyState = { remainingUnits: '0', periodEnd: 0, expiry: 0, isRevoked: false };
		await expect(
			t.action(api.accessKeys.authorize, {
				sessionToken: wanjiru,
				requestId: r.requestId,
				approval: demoApproval,
				liveTxHashes: [{ containerId: r.containerIds[0], txHash: authTx }]
			})
		).rejects.toThrow(/not authorized on-chain/);
		stub.keyState = {
			remainingUnits: toUnits('45').toString(),
			periodEnd: Math.floor((Date.now() + DAY) / 1000),
			expiry: Math.floor((Date.now() + 50 * DAY) / 1000),
			isRevoked: false
		};
		const auth = await t.action(api.accessKeys.authorize, {
			sessionToken: wanjiru,
			requestId: r.requestId,
			approval: demoApproval,
			liveTxHashes: [{ containerId: r.containerIds[0], txHash: authTx }]
		});
		expect(auth.authorized[0].txHash).toBe(authTx);
		await t.mutation(api.releaseRequests.issueReleaseOrder, {
			sessionToken: adaeze,
			requestId: r.requestId
		});

		// Free time ends (20GP: 7 days); the sweep makes the node pull day 1.
		vi.setSystemTime(Date.now() + 7 * DAY + 5_000);
		const sweep = await t.action(internal.sweep.run, {});
		expect(sweep.errors).toEqual([]);
		let c = await t.query(api.containers.get, {
			sessionToken: wanjiru,
			containerId: r.containerIds[0]
		});
		expect(c.container.detentionDays).toBe(1);
		expect(c.container.pulledUnits).toBe(toUnits('45').toString());
		const pull = calls.find(
			(x) => x.name === 'pullDetention' && x.args.encPrivKey === 'enc:secret'
		)!;
		expect(pull.args).toMatchObject({
			amountUnits: toUnits('45').toString(),
			encPrivKey: 'enc:secret'
		});
		expect(c.payments.find((p) => p.kind === 'detention_pull')).toMatchObject({
			mode: 'live',
			day: 1
		});
		// the live indexer ran for the line that has a deposits account
		expect(calls.some((x) => x.name === 'listHeldReceipts')).toBe(true);

		// The second same-day pull: the chain (the node) refuses; periodEnd comes back in seconds and is normalised to ms.
		const periodEndSec = Math.floor((Date.now() + DAY) / 1000);
		stub.pulls.push({
			error: 'SpendingLimitExceeded',
			remainingUnits: '0',
			periodEnd: periodEndSec
		});
		const second = await t.action(api.demo.trySecondPull, {
			sessionToken: adaeze,
			containerId: r.containerIds[0]
		});
		expect(second).toMatchObject({
			refused: true,
			error: 'SpendingLimitExceeded',
			remainingUnits: '0',
			periodEnd: periodEndSec * 1000
		});
		c = await t.query(api.containers.get, {
			sessionToken: wanjiru,
			containerId: r.containerIds[0]
		});
		expect(c.payments.filter((p) => p.status === 'failed')).toHaveLength(1);
		expect(c.container.pulledUnits).toBe(toUnits('45').toString());

		// Return and settle: live revocation needs the importer's passkey, so it stays pending.
		await t.mutation(api.containers.recordReturn, {
			sessionToken: adaeze,
			containerId: r.containerIds[0],
			eirNumber: 'EIR-LIVE-2',
			depot: 'Apapa'
		});
		const done = await t.action(api.containers.postCharges, {
			sessionToken: adaeze,
			containerId: r.containerIds[0]
		});
		expect(done).toMatchObject({
			status: 'settled',
			revokePending: true,
			chargeUnits: toUnits('45').toString()
		});
		c = await t.query(api.containers.get, {
			sessionToken: wanjiru,
			containerId: r.containerIds[0]
		});
		expect(c.accessKey!.status).toBe('active');
		expect(c.accessKey!.revokeRequestedAt).toBeTruthy();
		const notes = await t.query(api.notifications.list, { sessionToken: wanjiru });
		expect(notes.items.some((n) => n.kind === 'revoke_key')).toBe(true);

		// The importer revokes in the browser; the server confirms with the chain and closes the key.
		stub.keyState = { ...stub.keyState, isRevoked: false };
		await expect(
			t.action(api.accessKeys.revoke, { sessionToken: wanjiru, containerId: r.containerIds[0] })
		).rejects.toThrow(/has not revoked/);
		stub.keyState = { ...stub.keyState, isRevoked: true };
		const rv = await t.action(api.accessKeys.revoke, {
			sessionToken: wanjiru,
			containerId: r.containerIds[0]
		});
		expect(rv.revoked).toBe(true);
		c = await t.query(api.containers.get, {
			sessionToken: wanjiru,
			containerId: r.containerIds[0]
		});
		expect(c.accessKey!.status).toBe('revoked');
	});

	it('live seed creates only the resolver, no fake chain history', async () => {
		vi.useFakeTimers();
		const t = newBackend({ '../../src/convex/tempoNode.ts': tempoNodeStub });
		process.env.TEMPO_MODE = 'live';
		await t.mutation(api.seed.ensure, {});
		const counts = await t.run(async (ctx) => ({
			orgs: (await ctx.db.query('organizations').collect()).length,
			containers: (await ctx.db.query('containers').collect()).length,
			receipts: (await ctx.db.query('sim_receipts').collect()).length
		}));
		expect(counts).toEqual({ orgs: 1, containers: 0, receipts: 0 });
		expect((await t.query(api.system.status, {})).chainMode).toBe('live');
	});
});
