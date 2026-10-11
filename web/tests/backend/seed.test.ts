import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, seeded, signIn, newBackend, DAY } from './setup';
import { toUnits } from '../../src/lib/shared/domain/money';
import { validateContainerNumber } from '../../src/lib/shared/domain/containerNumber';

afterEach(() => vi.useRealTimers());

describe('seed.ensure', () => {
	it('seeds the ARCHITECTURE section 7 world', async () => {
		const t = await seeded();
		const adaeze = await signIn(t, 'Adaeze Okafor');
		const containers = await t.query(api.containers.listForLine, { sessionToken: adaeze });
		const by = (s: string) => containers.filter((c) => c.state === s).length;
		const joseph = await signIn(t, 'Joseph Otieno');
		const kestrel = await t.query(api.containers.listForLine, { sessionToken: joseph });
		expect(kestrel.filter((c) => c.state === 'settled').length).toBe(3);
		// 11 settled with Meridian + 3 with Kestrel = 14 settled in total
		expect(by('settled') + kestrel.length).toBe(14);
		expect(by('in_free_time')).toBe(3);
		expect(by('in_detention')).toBe(2);
		expect(by('returned')).toBe(1);
		expect(by('disputed')).toBe(1);
		expect(by('awaiting_deposit')).toBe(3);
		const held = await t.query(api.heldTransfers.list, { sessionToken: adaeze, status: 'held' });
		expect(held.map((h) => h.reason).sort()).toEqual(['unknown_sender', 'wrong_token']);

		const dash = await t.query(api.dashboard.line, { sessionToken: adaeze });
		expect(dash.series.cashHeldPerDay).toHaveLength(30);
		expect(dash.series.refundsPerDay).toHaveLength(30);
		expect(dash.depositsHeldUnits).toBe(toUnits('7900').toString());
		expect(dash.depositFreeExposureUnits).toBe(toUnits('3265').toString());
		expect(dash.pastFreeTime).toBe(2);
		expect(dash.compliance.avgReturnToRefundMs!).toBeLessThan(120_000); // refunds land seconds after the return
		expect(dash.refundsDue).toHaveLength(1);

		// memo trail for every past step: a settled held container has deposit, charge/refund with memos
		const settled = containers.find((c) => c.state === 'settled' && c.mode === 'held')!;
		const detail = await t.query(api.containers.get, {
			sessionToken: adaeze,
			containerId: settled._id
		});
		expect(detail.payments.map((p) => p.kind)[0]).toBe('deposit');
		expect(detail.payments.every((p) => p.memo.length > 0 && p.status === 'confirmed')).toBe(true);
		expect(detail.events.length).toBeGreaterThanOrEqual(5);

		// history spreads over ~60 days
		const oldest = Math.min(...containers.map((c) => c.createdAt ?? Infinity));
		const now = (await t.query(api.system.status, {})).simNow;
		expect((now - oldest) / DAY).toBeGreaterThan(45);

		// importer view and track records
		const wanjiru = await signIn(t, 'Wanjiru Mwangi');
		const imp = await t.query(api.dashboard.importer, { sessionToken: wanjiru });
		expect(imp.depositFree.activeKeys).toBe(2);
		expect(imp.series.cashHeldPerDay).toHaveLength(30);
		const importers = await t.query(api.orgs.listImporters, { sessionToken: adaeze });
		const savanna = importers.find((i) => i.name === 'Savanna Agro Traders')!;
		expect(savanna.relationship!.cleanReturns).toBe(6);
		expect(savanna.suggestedMode).toBe('depositFree');
		expect(importers.find((i) => i.name === 'Harbourview Foods Ltd')!.suggestedMode).toBe('held');
	});

	it('every seeded container number is a valid ISO 6346 number', async () => {
		const t = await seeded();
		const nums = await t.run(async (ctx) =>
			(await ctx.db.query('containers').collect()).map((c) => c.number)
		);
		expect(nums.length).toBeGreaterThan(24);
		expect(nums.every((n) => validateContainerNumber(n))).toBe(true);
		expect(new Set(nums).size).toBe(nums.length);
	});

	it('the sim ledger matches the app: importers funded, guard receipts back every held deposit', async () => {
		const t = await seeded();
		const check = await t.run(async (ctx) => {
			const receipts = await ctx.db.query('sim_receipts').collect();
			const heldReceipts = receipts.filter((r) => r.status === 'held');
			const containers = await ctx.db.query('containers').collect();
			const heldContainers = containers.filter(
				(c) =>
					c.mode === 'held' &&
					[
						'deposit_held',
						'released',
						'in_free_time',
						'in_detention',
						'returned',
						'settling'
					].includes(c.state)
			);
			const heldTotal = heldContainers.reduce((s, c) => s + BigInt(c.receivedUnits ?? '0'), 0n);
			const guardTotal = heldReceipts
				.filter(
					(r) => r.token.endsWith('01') && containers.some((c) => c.depositAddress === r.recipient)
				)
				.reduce((s, r) => s + BigInt(r.amount), 0n);
			return { heldTotal, guardTotal };
		});
		expect(check.guardTotal).toBe(check.heldTotal);
	});

	it('is idempotent', async () => {
		vi.useFakeTimers();
		const t = newBackend();
		const first = await t.mutation(api.seed.ensure, {});
		const second = await t.mutation(api.seed.ensure, {});
		expect(first.seeded).toBe(true);
		expect(second.seeded).toBe(false);
		const count = () =>
			t.run(async (ctx) => ({
				orgs: (await ctx.db.query('organizations').collect()).length,
				users: (await ctx.db.query('users').collect()).length,
				containers: (await ctx.db.query('containers').collect()).length,
				payments: (await ctx.db.query('payments').collect()).length
			}));
		const counts = await count();
		await t.mutation(api.seed.ensure, {});
		expect(await count()).toEqual(counts);
	});
});
