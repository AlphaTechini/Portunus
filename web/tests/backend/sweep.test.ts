import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, internal, seeded, signIn, DAY } from './setup';
import { toUnits } from '../../src/lib/shared/domain/money';

afterEach(() => vi.useRealTimers());

describe('sweep', () => {
  it('catches up several missed days exactly once and is idempotent', async () => {
    const t = await seeded();
    const wanjiru = await signIn(t, 'Wanjiru Mwangi');
    const adaeze = await signIn(t, 'Adaeze Okafor');
    const target = (await t.query(api.containers.listForImporter, { sessionToken: wanjiru, filter: { states: ['in_detention'] } })).find((c) => c.mode === 'depositFree')!;
    expect(target.detentionDays).toBe(3);

    // Five days pass with no job running: one sweep pulls days 4..8, each exactly once.
    const adv = await t.action(api.demo.advanceClock, { sessionToken: adaeze, ms: 5 * DAY });
    expect(adv.sweep.errors).toEqual([]);
    expect(adv.sweep.detentionDaysProcessed).toBeGreaterThanOrEqual(5);
    const pullsOf = async () => {
      const c = await t.query(api.containers.get, { sessionToken: wanjiru, containerId: target._id });
      return { c: c.container, pulls: c.payments.filter((p) => p.kind === 'detention_pull' && p.status === 'confirmed') };
    };
    let s = await pullsOf();
    expect(s.c.detentionDays).toBe(8);
    expect(s.pulls).toHaveLength(8);
    expect(new Set(s.pulls.map((p) => p.day)).size).toBe(8);
    expect(s.c.pulledUnits).toBe(toUnits(8 * 45).toString());
    // each pull carries its day in the memo and is spaced one day apart
    expect(s.pulls[7].memo).toMatch(/^PC MRDU\d{7} D08 /);
    expect(s.pulls[7].timestamp - s.pulls[6].timestamp).toBe(DAY);

    // Running the sweep again, and again, changes nothing.
    const again = await t.action(internal.sweep.run, {});
    const again2 = await t.action(internal.sweep.run, {});
    expect(again.detentionDaysProcessed + again2.detentionDaysProcessed).toBe(0);
    s = await pullsOf();
    expect(s.pulls).toHaveLength(8);
    expect(s.c.detentionDays).toBe(8);

    // Every sweep and job leaves an audit row.
    const runs = await t.run(async (ctx) => await ctx.db.query('jobRuns').collect());
    expect(runs.filter((r) => r.kind === 'sweep').length).toBe(3);
    expect(runs.every((r) => r.ok !== false)).toBe(true);
  });

  it('held containers accrue per started day and stop at the deposit', async () => {
    const t = await seeded();
    const carlo = await signIn(t, 'Carlo Reyes');
    const adaeze = await signIn(t, 'Adaeze Okafor');
    const before = (await t.query(api.containers.listForImporter, { sessionToken: carlo, filter: { states: ['in_detention'] } })).find((c) => c.mode === 'held')!;
    expect([before.detentionDays, before.accruedUnits]).toEqual([3, toUnits(225).toString()]);
    await t.action(api.demo.advanceClock, { sessionToken: adaeze, ms: 40 * DAY });
    const after = await t.query(api.containers.get, { sessionToken: carlo, containerId: before._id });
    expect(after.container.detentionDays).toBe(30); // maxDetentionDays
    expect(after.container.accruedUnits).toBe(toUnits(2000).toString()); // 30 x 75.00 = 2250 capped at the 2000.00 deposit
    // Held mode: no money moved while accruing.
    expect(after.payments.map((p) => p.kind)).toEqual(['deposit']);
  });

  it('warns the line and the importer a day before an access key expires', async () => {
    const t = await seeded();
    const adaeze = await signIn(t, 'Adaeze Okafor');
    const wanjiru = await signIn(t, 'Wanjiru Mwangi');
    await t.action(api.demo.advanceClock, { sessionToken: adaeze, ms: 31 * DAY });
    const line = await t.query(api.notifications.list, { sessionToken: adaeze, limit: 200 });
    const imp = await t.query(api.notifications.list, { sessionToken: wanjiru, limit: 200 });
    expect(line.items.some((n) => n.kind === 'key_expiry')).toBe(true);
    expect(imp.items.some((n) => n.kind === 'key_expiry')).toBe(true);
    // Warned once only.
    await t.action(internal.sweep.run, {});
    const imp2 = await t.query(api.notifications.list, { sessionToken: wanjiru, limit: 200 });
    expect(imp2.items.filter((n) => n.kind === 'key_expiry').length).toBe(imp.items.filter((n) => n.kind === 'key_expiry').length);
  });

  it('recovers a settlement that died half way and retries it', async () => {
    const t = await seeded();
    const adaeze = await signIn(t, 'Adaeze Okafor');
    const tunde = await signIn(t, 'Tunde Bakare');
    const returned = (await t.query(api.containers.listForImporter, { sessionToken: tunde, filter: { states: ['returned'] } }))[0];
    // Simulate: the settle mutation ran but the action died before the chain step.
    await t.run(async (ctx) => {
      await ctx.db.patch(returned._id, { state: 'settling', pendingOnChain: { step: 'settle', since: Date.now(), attempts: 1 } });
    });
    const adv = await t.action(api.demo.advanceClock, { sessionToken: adaeze, ms: 3 * DAY });
    expect(adv.sweep.recovered).toBe(1);
    const c = await t.query(api.containers.get, { sessionToken: tunde, containerId: returned._id });
    expect(c.container.state).toBe('settled');
    expect(c.payments.filter((p) => p.kind === 'refund')).toHaveLength(1);
  });
});
