import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, seeded, signIn, newBackend, DAY } from './setup';
import { fromUnits } from '../../src/lib/shared/domain/money';

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
		process.stdout.write("\n"+JSON.stringify({ ...dash, series: undefined, recent: undefined }, null, 1));
		process.stdout.write("\n"+dash.series.cashHeldPerDay.map((p) => fromUnits(p.valueUnits)).join(' '));
		process.stdout.write("\n"+dash.series.refundsPerDay.map((p) => fromUnits(p.valueUnits)).join(' '));
	});

	it('is idempotent', async () => {
		vi.useFakeTimers();
		const t = newBackend();
		const first = await t.mutation(api.seed.ensure, {});
		const second = await t.mutation(api.seed.ensure, {});
		expect(first.seeded).toBe(true);
		expect(second.seeded).toBe(false);
		const counts = await t.run(async (ctx) => ({
			orgs: (await ctx.db.query('organizations').collect()).length,
			containers: (await ctx.db.query('containers').collect()).length
		}));
		await t.mutation(api.seed.ensure, {});
		const counts2 = await t.run(async (ctx) => ({
			orgs: (await ctx.db.query('organizations').collect()).length,
			containers: (await ctx.db.query('containers').collect()).length
		}));
		expect(counts2).toEqual(counts);
		void DAY;
	});
});
