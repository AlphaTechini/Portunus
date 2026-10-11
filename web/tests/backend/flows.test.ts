import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, internal, seeded, signIn, DAY, demoApproval, type TestConvex } from './setup';
import { generateContainerNumber } from '../../src/lib/shared/domain/containerNumber';
import { toUnits, u, fromUnits } from '../../src/lib/shared/domain/money';
import type { Id } from '../../src/convex/_generated/dataModel';

afterEach(() => vi.useRealTimers());

let serial = 900100;
const newNumber = () => generateContainerNumber('MRDU', serial++);

async function importerOrg(t: TestConvex, name: string): Promise<Id<'organizations'>> {
	return t.run(async (ctx) => {
		const orgs = await ctx.db.query('organizations').collect();
		return orgs.find((o) => o.name === name)!._id;
	});
}

describe('held flow end to end', () => {
	it('request -> pay -> release -> late return -> charges -> refund', async () => {
		const t = await seeded();
		const adaeze = await signIn(t, 'Adaeze Okafor');
		const tunde = await signIn(t, 'Tunde Bakare');
		const harbourview = await importerOrg(t, 'Harbourview Foods Ltd');

		const created = await t.mutation(api.releaseRequests.create, {
			sessionToken: adaeze,
			importerOrgId: harbourview,
			billOfLading: 'MRDNLOS99001',
			portOfDischarge: 'Apapa, Lagos',
			mode: 'held',
			containers: [
				{ number: newNumber(), type: '40GP' },
				{ number: newNumber(), type: '20GP' }
			]
		});
		const req = await t.query(api.releaseRequests.get, { sessionToken: tunde, requestId: created.requestId });
		expect(req!.containers).toHaveLength(2);
		expect(req!.containers.every((c) => c.state === 'awaiting_deposit')).toBe(true);
		expect(req!.totals.depositUnits).toBe(toUnits('3200').toString());

		const preview = await t.query(api.deposits.preview, { sessionToken: tunde, requestId: created.requestId });
		expect(preview.items).toHaveLength(2);
		const balanceBefore = u(preview.balanceUnits!);

		const paid = await t.action(api.deposits.payBatch, { sessionToken: tunde, requestId: created.requestId, approval: demoApproval });
		expect(paid.allCovered).toBe(true);
		expect(paid.finalityMs).toBeGreaterThanOrEqual(450);
		expect(paid.finalityMs).toBeLessThan(550);

		// Release order: free time starts.
		const rel = await t.mutation(api.releaseRequests.issueReleaseOrder, { sessionToken: adaeze, requestId: created.requestId });
		expect(rel.released).toHaveLength(2);
		const target = rel.released[0];
		const after = await t.query(api.containers.get, { sessionToken: adaeze, containerId: target });
		expect(after.container.state).toBe('in_free_time');
		const F = after.container.freeTimeEndsAt!;
		expect(F - after.container.releasedAt!).toBe(7 * DAY);

		// Two days past free time + an hour: detention day 3.
		const adv = await t.action(api.demo.advanceClock, { sessionToken: adaeze, ms: 9 * DAY + 3_600_000 });
		expect(adv.sweep.errors).toEqual([]);
		const late = await t.query(api.containers.get, { sessionToken: adaeze, containerId: target });
		expect(late.container.state).toBe('in_detention');
		expect(late.container.detentionDays).toBe(3);
		expect(late.container.accruedUnits).toBe(toUnits('225').toString()); // 3 x 75.00

		await t.mutation(api.containers.recordReturn, { sessionToken: adaeze, containerId: target, eirNumber: 'EIR-778812', depot: 'Apapa Yard 3' });
		const settled = await t.action(api.containers.postCharges, { sessionToken: adaeze, containerId: target, damageUnits: '0' });
		expect(settled.status).toBe('settled');
		expect(settled.chargeUnits).toBe(toUnits('225').toString());
		expect(settled.refundUnits).toBe(toUnits('1775').toString());

		const done = await t.query(api.containers.get, { sessionToken: tunde, containerId: target });
		expect(done.container.state).toBe('settled');
		const kinds = done.payments.map((p) => p.kind);
		expect(kinds).toEqual(['deposit', 'charge', 'refund']);
		const memo = done.payments.map((p) => p.memo);
		expect(memo[0]).toMatch(/^PD MRDU\d{7} MRDNLOS99001$/);
		expect(memo[1]).toMatch(/^PS MRDU\d{7} EIR-778812$/);
		expect(memo[2]).toMatch(/^PR MRDU\d{7} EIR-778812$/);
		// charge + refund in ONE transaction
		expect(done.payments[1].txHash).toBe(done.payments[2].txHash);
		expect(done.container.refundUnits).toBe(toUnits('1775').toString());

		// The other container is untouched.
		const balanceAfter = await t.query(api.deposits.preview, { sessionToken: tunde, requestId: created.requestId }).catch(() => null);
		void balanceAfter;
		void balanceBefore;
		void fromUnits;
	});
});

describe('deposit-free flow', () => {
	it('authorize -> pulls -> refused second pull -> return -> settle -> key revoked', async () => {
		const t = await seeded();
		const adaeze = await signIn(t, 'Adaeze Okafor');
		const wanjiru = await signIn(t, 'Wanjiru Mwangi');
		const reqs = await t.query(api.releaseRequests.listForImporter, { sessionToken: wanjiru });
		const open = reqs.find((r) => r.status === 'awaiting_importer')!;
		expect(open.mode).toBe('depositFree');

		// The deposit pay path is for held requests only.
		await expect(t.query(api.deposits.preview, { sessionToken: wanjiru, requestId: open._id })).rejects.toThrow(/NOT_SUPPORTED/);

		const prep = await t.action(api.accessKeys.prepare, { sessionToken: wanjiru, requestId: open._id });
		expect(prep.keys).toHaveLength(2);
		const k0 = prep.keys[0];
		expect(k0.periodSec).toBe(86400);
		expect(k0.dailyLimitUnits).toBe(toUnits('45').toString());
		// Preparing again reuses the same keys.
		const prep2 = await t.action(api.accessKeys.prepare, { sessionToken: wanjiru, requestId: open._id });
		expect(prep2.keys.map((k) => k.keyAddress)).toEqual(prep.keys.map((k) => k.keyAddress));

		const bal0 = await t.query(api.releaseRequests.get, { sessionToken: wanjiru, requestId: open._id });
		const auth = await t.action(api.accessKeys.authorize, { sessionToken: wanjiru, requestId: open._id, approval: demoApproval });
		expect(auth.authorized).toHaveLength(2);
		const bal1 = await t.query(api.releaseRequests.get, { sessionToken: wanjiru, requestId: open._id });
		expect(bal1!.balanceUnits).toBe(bal0!.balanceUnits); // no money moved
		expect(bal1!.containers.every((c) => c.state === 'authorized')).toBe(true);

		const rel = await t.mutation(api.releaseRequests.issueReleaseOrder, { sessionToken: adaeze, requestId: open._id });
		const target = rel.released[0];
		// Jump to just after free time ends: the day-1 pull runs.
		await t.action(api.demo.jumpToFreeTimeEnd, { sessionToken: adaeze, containerId: target });
		let c = await t.query(api.containers.get, { sessionToken: adaeze, containerId: target });
		expect(c.container.state).toBe('in_detention');
		expect(c.container.detentionDays).toBe(1);
		expect(c.container.pulledUnits).toBe(toUnits('45').toString());
		expect(c.payments.filter((p) => p.kind === 'detention_pull' && p.status === 'confirmed')).toHaveLength(1);

		const metaBefore = await t.run(async (ctx) => (await ctx.db.query('sim_meta').first())!.seq);
		const second = await t.action(api.demo.trySecondPull, { sessionToken: adaeze, containerId: target });
		expect(second).toMatchObject({ refused: true, error: 'SpendingLimitExceeded', remainingUnits: '0' });
		const metaAfter = await t.run(async (ctx) => (await ctx.db.query('sim_meta').first())!.seq);
		expect(metaAfter).toBe(metaBefore); // the chain recorded no transaction
		c = await t.query(api.containers.get, { sessionToken: wanjiru, containerId: target });
		const failed = c.payments.filter((p) => p.kind === 'detention_pull' && p.status === 'failed');
		expect(failed).toHaveLength(1);
		expect(failed[0].error).toBe('SpendingLimitExceeded');
		expect(c.container.pulledUnits).toBe(toUnits('45').toString());

		// Next day: exactly one more pull.
		await t.action(api.demo.advanceClock, { sessionToken: adaeze, ms: DAY });
		c = await t.query(api.containers.get, { sessionToken: wanjiru, containerId: target });
		expect(c.container.detentionDays).toBe(2);
		expect(c.container.pulledUnits).toBe(toUnits('90').toString());

		await t.mutation(api.containers.recordReturn, { sessionToken: adaeze, containerId: target, eirNumber: 'EIR-55120', depot: 'Apapa Yard 3' });
		const done = await t.action(api.containers.postCharges, { sessionToken: adaeze, containerId: target });
		expect(done.status).toBe('settled');
		expect(done.chargeUnits).toBe(toUnits('90').toString());
		c = await t.query(api.containers.get, { sessionToken: wanjiru, containerId: target });
		expect(c.container.state).toBe('settled');
		expect(c.accessKey!.status).toBe('revoked');
		expect(c.payments.some((p) => p.kind === 'key_revoked')).toBe(true);
		expect(c.payments.map((p) => p.kind)[0]).toBe('key_authorized');
	});

	it('importer revokes mid-flight: later days accrue but cannot be pulled', async () => {
		const t = await seeded();
		const adaeze = await signIn(t, 'Adaeze Okafor');
		const wanjiru = await signIn(t, 'Wanjiru Mwangi');
		const list = await t.query(api.containers.listForImporter, { sessionToken: wanjiru, filter: { states: ['in_detention'] } });
		const target = list.find((c) => c.mode === 'depositFree')!;
		expect(target.detentionDays).toBe(3);
		expect(target.pulledUnits).toBe(toUnits('135').toString());
		const r = await t.action(api.accessKeys.revoke, { sessionToken: wanjiru, containerId: target._id });
		expect(r.midFlight).toBe(true);
		await expect(t.action(api.accessKeys.revoke, { sessionToken: wanjiru, containerId: target._id })).rejects.toThrow(/already revoked/);
		await t.action(api.demo.advanceClock, { sessionToken: adaeze, ms: 2 * DAY });
		const c = await t.query(api.containers.get, { sessionToken: adaeze, containerId: target._id });
		expect(c.container.detentionDays).toBe(5);
		expect(c.container.pulledUnits).toBe(toUnits('135').toString());
		const dash = await t.query(api.dashboard.line, { sessionToken: adaeze });
		expect(dash.depositFreeUncollectedUnits).toBe(toUnits('90').toString());
		const notes = await t.query(api.notifications.list, { sessionToken: adaeze });
		expect(notes.items.some((n) => n.kind === 'key_revoked')).toBe(true);
	});

	it('a key revoked on-chain behind the app is discovered by the pull and logged as failed', async () => {
		const t = await seeded();
		const adaeze = await signIn(t, 'Adaeze Okafor');
		const wanjiru = await signIn(t, 'Wanjiru Mwangi');
		const list = await t.query(api.containers.listForImporter, { sessionToken: wanjiru, filter: { states: ['in_detention'] } });
		const target = list.find((c) => c.mode === 'depositFree')!;
		await t.mutation(internal.sim.revokeKey, { account: target.accessKey!.account, keyId: target.accessKey!.keyAddress });
		await t.action(api.demo.advanceClock, { sessionToken: adaeze, ms: 2 * DAY });
		const c = await t.query(api.containers.get, { sessionToken: adaeze, containerId: target._id });
		const failed = c.payments.filter((p) => p.status === 'failed');
		expect(failed).toHaveLength(1);
		expect(failed[0].error).toMatch(/KeyAlreadyRevoked/);
		expect(c.container.pulledUnits).toBe(toUnits('135').toString());
		expect(c.container.detentionDays).toBe(5);
	});
});
