import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, seeded, signIn, demoApproval, orgId, newRequest, DAY } from './setup';
import { toUnits, u } from '../../src/lib/shared/domain/money';

afterEach(() => vi.useRealTimers());

describe('paying deposits', () => {
	it('partial payment keeps the release blocked; the rest completes it; overpayment refunds at settlement', async () => {
		const t = await seeded();
		const adaeze = await signIn(t, 'Adaeze Okafor');
		const tunde = await signIn(t, 'Tunde Bakare');
		const r = await newRequest(t, adaeze, await orgId(t, 'Harbourview Foods Ltd'), [
			'20GP',
			'40GP'
		]);
		const [c1, c2] = r.containerIds;

		// Pay only part of the first container and overpay the second by 300.00.
		const first = await t.action(api.deposits.payBatch, {
			sessionToken: tunde,
			requestId: r.requestId,
			approval: demoApproval,
			amountOverrides: [
				{ containerId: c1, amountUnits: toUnits('700').toString() },
				{ containerId: c2, amountUnits: toUnits('2300').toString() }
			]
		});
		expect(first.allCovered).toBe(false);
		const row1 = first.containers.find((c) => c.containerId === c1)!;
		expect(row1.state).toBe('awaiting_deposit');
		expect(row1.receivedUnits).toBe(toUnits('700').toString());
		expect(row1.missingUnits).toBe(toUnits('500').toString());
		expect(first.containers.find((c) => c.containerId === c2)!.state).toBe('deposit_held');

		// The release order covers only what is covered and reports what is missing.
		const rel = await t.mutation(api.releaseRequests.issueReleaseOrder, {
			sessionToken: adaeze,
			requestId: r.requestId
		});
		expect(rel.released).toEqual([c2]);
		expect(rel.blocked[0]).toMatchObject({
			containerId: c1,
			missingUnits: toUnits('500').toString()
		});

		// The preview now asks for the missing 500.00 only.
		const preview = await t.query(api.deposits.preview, {
			sessionToken: tunde,
			requestId: r.requestId
		});
		expect(preview.items).toHaveLength(1);
		expect(preview.items[0].amountUnits).toBe(toUnits('500').toString());
		const second = await t.action(api.deposits.payBatch, {
			sessionToken: tunde,
			requestId: r.requestId,
			approval: demoApproval
		});
		expect(second.allCovered).toBe(true);
		const rel2 = await t.mutation(api.releaseRequests.issueReleaseOrder, {
			sessionToken: adaeze,
			requestId: r.requestId
		});
		expect(rel2.released).toEqual([c1]);

		// Return the overpaid container on time: the 300.00 excess comes back with the refund.
		await t.mutation(api.containers.recordReturn, {
			sessionToken: adaeze,
			containerId: c2,
			eirNumber: 'EIR-1001',
			depot: 'Apapa Yard 3'
		});
		const done = await t.action(api.containers.postCharges, {
			sessionToken: adaeze,
			containerId: c2
		});
		expect(done.chargeUnits).toBe('0');
		expect(done.refundUnits).toBe(toUnits('2300').toString());
		const detail = await t.query(api.containers.get, { sessionToken: tunde, containerId: c2 });
		expect(detail.payments.map((p) => p.kind)).toEqual(['deposit', 'refund']);
	});

	it('refuses the whole batch atomically when the payer cannot cover it', async () => {
		const t = await seeded();
		const adaeze = await signIn(t, 'Adaeze Okafor');
		const tunde = await signIn(t, 'Tunde Bakare');
		const r = await newRequest(t, adaeze, await orgId(t, 'Harbourview Foods Ltd'), [
			'20GP',
			'40GP'
		]);
		const [c1] = r.containerIds;
		const before = await t.query(api.deposits.preview, {
			sessionToken: tunde,
			requestId: r.requestId
		});
		const err = await t
			.action(api.deposits.payBatch, {
				sessionToken: tunde,
				requestId: r.requestId,
				approval: demoApproval,
				amountOverrides: [{ containerId: c1, amountUnits: toUnits('999999').toString() }]
			})
			.catch((e) => e);
		expect(String(err)).toMatch(/INSUFFICIENT_BALANCE/);
		const after = await t.query(api.deposits.preview, {
			sessionToken: tunde,
			requestId: r.requestId
		});
		expect(after.balanceUnits).toBe(before.balanceUnits);
		const req = await t.query(api.releaseRequests.get, {
			sessionToken: tunde,
			requestId: r.requestId
		});
		expect(
			req!.containers.every((c) => c.state === 'awaiting_deposit' && c.receivedUnits === '0')
		).toBe(true);
		const payments = await t.run(async (ctx) =>
			(await ctx.db.query('payments').collect()).filter((p) => p.requestId === r.requestId)
		);
		expect(payments).toHaveLength(0);
	});

	it('the deposit never enters the line balance: it sits in a guard receipt', async () => {
		const t = await seeded();
		const adaeze = await signIn(t, 'Adaeze Okafor');
		const tunde = await signIn(t, 'Tunde Bakare');
		const r = await newRequest(t, adaeze, await orgId(t, 'Harbourview Foods Ltd'), ['40HC']);
		const lineBefore = await t.run(async (ctx) => {
			const line = (await ctx.db.query('organizations').collect()).find(
				(o) => o.shortCode === 'MRDN'
			)!;
			return { deposits: line.depositsAccount!, charges: line.chargesAddress! };
		});
		await t.action(api.deposits.payBatch, {
			sessionToken: tunde,
			requestId: r.requestId,
			approval: demoApproval
		});
		const state = await t.run(async (ctx) => {
			const bal = async (a: string) =>
				(await ctx.db.query('sim_balances').collect()).filter((b) => b.address === a.toLowerCase());
			const receipts = await ctx.db.query('sim_receipts').collect();
			const container = (await ctx.db.query('containers').collect()).find(
				(c) => c._id === r.containerIds[0]
			)!;
			return {
				depositsBal: await bal(lineBefore.deposits),
				chargesBal: await bal(lineBefore.charges),
				receipt: receipts.find((x) => x.recipient === container.depositAddress)!
			};
		});
		expect(state.depositsBal).toHaveLength(0);
		expect(state.receipt.status).toBe('held');
		expect(state.receipt.amount).toBe(toUnits('2200').toString());
		expect(state.receipt.blockedReason).toBe('receivePolicy');
		expect(state.receipt.receipt.length).toBe(2 + 320 * 2);
		expect(u(state.receipt.amount)).toBeGreaterThan(0n);
		void DAY;
	});

	it('authorization: other organizations cannot see or pay a request', async () => {
		const t = await seeded();
		const adaeze = await signIn(t, 'Adaeze Okafor');
		const carlo = await signIn(t, 'Carlo Reyes');
		const joseph = await signIn(t, 'Joseph Otieno');
		const r = await newRequest(t, adaeze, await orgId(t, 'Harbourview Foods Ltd'), ['20GP']);
		await expect(
			t.query(api.releaseRequests.get, { sessionToken: carlo, requestId: r.requestId })
		).rejects.toThrow(/NOT_FOUND/);
		await expect(
			t.query(api.releaseRequests.get, { sessionToken: joseph, requestId: r.requestId })
		).rejects.toThrow(/NOT_FOUND/);
		await expect(
			t.action(api.deposits.payBatch, {
				sessionToken: carlo,
				requestId: r.requestId,
				approval: demoApproval
			})
		).rejects.toThrow(/NOT_FOUND/);
		await expect(
			t.query(api.containers.get, { sessionToken: carlo, containerId: r.containerIds[0] })
		).rejects.toThrow(/NOT_FOUND/);
		await expect(
			t.mutation(api.releaseRequests.issueReleaseOrder, {
				sessionToken: joseph,
				requestId: r.requestId
			})
		).rejects.toThrow(/NOT_FOUND/);
		// role checks
		await expect(t.query(api.dashboard.line, { sessionToken: carlo })).rejects.toThrow(/FORBIDDEN/);
		await expect(t.query(api.dashboard.importer, { sessionToken: adaeze })).rejects.toThrow(
			/FORBIDDEN/
		);
		await expect(t.query(api.dashboard.line, { sessionToken: 'nope' })).rejects.toThrow(
			/UNAUTHENTICATED/
		);
	});
});
