import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, seeded, signIn, orgId, newRequest, DAY } from './setup';
import { toUnits } from '../../src/lib/shared/domain/money';

afterEach(() => vi.useRealTimers());

describe('held transfers (wrong token / unknown sender)', () => {
	it('are held by the guard and returned through the settlement contract, never lost', async () => {
		const t = await seeded();
		const adaeze = await signIn(t, 'Adaeze Okafor');
		const list = await t.query(api.heldTransfers.list, { sessionToken: adaeze, status: 'held' });
		expect(list).toHaveLength(2);
		const wrong = list.find((h) => h.reason === 'wrong_token')!;
		expect(wrong.tokenSymbol).toBe('BetaUSD');
		expect(wrong.amountUnits).toBe(toUnits('250').toString());
		const stranger = wrong.originator;

		const balance = (token: string) =>
			t.run(async (ctx) => {
				const rows = await ctx.db.query('sim_balances').collect();
				return BigInt(rows.find((r) => r.address === stranger && r.token === token)?.amount ?? '0');
			});
		const beta = wrong.token;
		const before = await balance(beta);
		const r = await t.action(api.heldTransfers.returnToSender, {
			sessionToken: adaeze,
			heldTransferId: wrong._id
		});
		expect(r.txHash).toMatch(/^0x[0-9a-f]{64}$/);
		expect(r.finalityMs).toBeGreaterThanOrEqual(450);
		expect((await balance(beta)) - before).toBe(toUnits('250'));

		const after = await t.query(api.heldTransfers.list, { sessionToken: adaeze });
		expect(after.find((h) => h._id === wrong._id)!.status).toBe('returned');
		expect(after.filter((h) => h.status === 'held')).toHaveLength(1);
		// The return is in the memo trail.
		const payments = await t.run(async (ctx) =>
			(await ctx.db.query('payments').collect()).filter((p) => p.kind === 'held_return')
		);
		expect(payments).toHaveLength(1);
		expect(payments[0].memo).toMatch(/^PX [0-9a-f]{16}$/);
		// Returned once only.
		await expect(
			t.action(api.heldTransfers.returnToSender, {
				sessionToken: adaeze,
				heldTransferId: wrong._id
			})
		).rejects.toThrow(/already returned/);
		// Another line cannot touch it.
		const joseph = await signIn(t, 'Joseph Otieno');
		const other = after.find((h) => h.status === 'held')!;
		await expect(
			t.action(api.heldTransfers.returnToSender, {
				sessionToken: joseph,
				heldTransferId: other._id
			})
		).rejects.toThrow(/NOT_FOUND/);
	});

	it('demo.sendStrangerTransfer creates wrong_token and unknown_sender transfers', async () => {
		const t = await seeded();
		const adaeze = await signIn(t, 'Adaeze Okafor');
		const meridian = await orgId(t, 'Meridian Ocean Lines');
		const a = await t.action(api.demo.sendStrangerTransfer, {
			sessionToken: adaeze,
			lineOrgId: meridian,
			token: 'BetaUSD'
		});
		expect(a.reason).toBe('wrong_token');
		const b = await t.action(api.demo.sendStrangerTransfer, {
			sessionToken: adaeze,
			lineOrgId: meridian,
			token: 'AlphaUSD'
		});
		expect(b.reason).toBe('unknown_sender');
		const held = await t.query(api.heldTransfers.list, { sessionToken: adaeze, status: 'held' });
		expect(held).toHaveLength(4);
		// A stranger's AlphaUSD to a container's own address is NOT counted as that container's deposit.
		const tunde = await signIn(t, 'Tunde Bakare');
		const r = await newRequest(t, adaeze, await orgId(t, 'Harbourview Foods Ltd'), ['20GP']);
		const c = await t.action(api.demo.sendStrangerTransfer, {
			sessionToken: adaeze,
			lineOrgId: meridian,
			token: 'AlphaUSD'
		});
		expect(c.reason).toBe('unknown_sender');
		const req = await t.query(api.releaseRequests.get, {
			sessionToken: tunde,
			requestId: r.requestId
		});
		expect(req!.containers[0].receivedUnits).toBe('0');
		expect(req!.containers[0].state).toBe('awaiting_deposit');
		void DAY;
	});

	it('demo controls are refused when DEMO_MODE is off', async () => {
		const t = await seeded();
		const adaeze = await signIn(t, 'Adaeze Okafor');
		process.env.DEMO_MODE = 'off';
		try {
			await expect(
				t.action(api.demo.advanceClock, { sessionToken: adaeze, ms: DAY })
			).rejects.toThrow(/DEMO_DISABLED/);
			const personas = await t.query(api.auth.listDemoPersonas, {});
			expect(personas).toEqual([]);
		} finally {
			process.env.DEMO_MODE = 'on';
		}
	});

	it('demo.reset wipes and reseeds', async () => {
		const t = await seeded();
		const adaeze = await signIn(t, 'Adaeze Okafor');
		await t.action(api.demo.advanceClock, { sessionToken: adaeze, ms: 10 * DAY });
		expect((await t.query(api.system.status, {})).simClockOffsetMs).toBe(10 * DAY);
		const r = await t.action(api.demo.reset, {});
		expect(r.seeded).toBe(true);
		expect((await t.query(api.system.status, {})).simClockOffsetMs).toBe(0);
		await expect(t.query(api.dashboard.line, { sessionToken: adaeze })).rejects.toThrow(
			/UNAUTHENTICATED/
		);
		const again = await signIn(t, 'Adaeze Okafor');
		const containers = await t.query(api.containers.listForLine, { sessionToken: again });
		expect(containers.filter((c) => c.state === 'settled')).toHaveLength(11);
	});
});
