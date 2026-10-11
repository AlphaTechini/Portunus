import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	api,
	internal,
	seeded,
	signIn,
	demoApproval,
	orgId,
	newRequest,
	releasedHeld,
	DAY
} from './setup';
import { toUnits } from '../../src/lib/shared/domain/money';

afterEach(() => vi.useRealTimers());

const rejects = async (p: Promise<unknown>, re: RegExp) => expect(p).rejects.toThrow(re);

describe('settlement window and caps', () => {
	it('only after the window ends, at most once, by anyone', async () => {
		const t = await seeded();
		const tunde = await signIn(t, 'Tunde Bakare');
		const adaeze = await signIn(t, 'Adaeze Okafor');
		const returned = (
			await t.query(api.containers.listForImporter, {
				sessionToken: tunde,
				filter: { states: ['returned'] }
			})
		)[0];
		expect(returned.settlementWindowEndsAt! - returned.returnedAt!).toBe(3 * DAY);
		// Window still open: nobody can force it.
		await rejects(
			t.action(api.containers.triggerSettlement, {
				sessionToken: tunde,
				containerId: returned._id
			}),
			/WINDOW_OPEN/
		);
		await rejects(
			t.action(api.containers.triggerSettlement, {
				sessionToken: adaeze,
				containerId: returned._id
			}),
			/WINDOW_OPEN/
		);
		const dash = await t.query(api.dashboard.line, { sessionToken: adaeze });
		expect(dash.refundsDue).toHaveLength(1);
		expect(dash.refundsDue[0]).toMatchObject({
			containerId: returned._id,
			amountUnits: toUnits('2120').toString(),
			overdue: false
		});

		// The window ends: the sweep (run by advanceClock) settles automatically.
		await t.action(api.demo.advanceClock, { sessionToken: adaeze, ms: 2 * DAY + 60_000 });
		const c = await t.query(api.containers.get, { sessionToken: tunde, containerId: returned._id });
		expect(c.container.state).toBe('settled');
		expect(c.container.chargesUnits).toBe(toUnits('80').toString());
		expect(c.container.refundUnits).toBe(toUnits('2120').toString());
		const kinds = () => c.payments.map((p) => p.kind).join(',');
		expect(kinds()).toBe('deposit,charge,refund');

		// Settlement happens once: a second trigger is refused and nothing is paid twice.
		await rejects(
			t.action(api.containers.triggerSettlement, {
				sessionToken: tunde,
				containerId: returned._id
			}),
			/INVALID_STATE/
		);
		await rejects(
			t.action(api.containers.postCharges, { sessionToken: adaeze, containerId: returned._id }),
			/INVALID_STATE/
		);
		const again = await t.action(api.containers.settleMany, {
			sessionToken: adaeze,
			containerIds: [returned._id]
		});
		expect(again.settled).toBe(0);
		const c2 = await t.query(api.containers.get, {
			sessionToken: tunde,
			containerId: returned._id
		});
		expect(c2.payments).toHaveLength(3);
		// The importer's track record counted it as a (1-day) late return, not clean.
		const importers = await t.query(api.orgs.listImporters, { sessionToken: adaeze });
		expect(
			importers.find((i) => i.name === 'Harbourview Foods Ltd')!.relationship!.lateReturns
		).toBe(1);
	});

	it('charges never exceed the deposit, nor accrued detention plus damage', async () => {
		const t = await seeded();
		const adaeze = await signIn(t, 'Adaeze Okafor');
		const tunde = await signIn(t, 'Tunde Bakare');
		const hv = await orgId(t, 'Harbourview Foods Ltd');
		const { containerIds } = await releasedHeld(t, adaeze, tunde, hv, ['20GP', '20GP', '20GP']);
		const [onTime, capped, late] = containerIds;
		// On-time container: 300.00 damage -> charge 300.00, refund 900.00
		await t.mutation(api.containers.recordReturn, {
			sessionToken: adaeze,
			containerId: onTime,
			eirNumber: 'EIR-A1',
			depot: 'Apapa'
		});
		const a = await t.action(api.containers.postCharges, {
			sessionToken: adaeze,
			containerId: onTime,
			damageUnits: toUnits('300').toString(),
			note: 'Dent in side panel'
		});
		expect([a.chargeUnits, a.refundUnits]).toEqual([
			toUnits('300').toString(),
			toUnits('900').toString()
		]);
		expect(a.cappedByDeposit).toBe(false);
		expect(a.finalityMs).toBeGreaterThanOrEqual(450);
		expect(a.finalityMs).toBeLessThan(550);

		// 40 days late: detention is capped at maxDetentionDays (30) and at the deposit (1200).
		await t.action(api.demo.advanceClock, { sessionToken: adaeze, ms: 7 * DAY + 40 * DAY });
		const c = await t.query(api.containers.get, { sessionToken: adaeze, containerId: capped });
		expect(c.container.detentionDays).toBe(30);
		expect(c.container.accruedUnits).toBe(toUnits('1200').toString());
		await t.mutation(api.containers.recordReturn, {
			sessionToken: adaeze,
			containerId: capped,
			eirNumber: 'EIR-A2',
			depot: 'Apapa'
		});
		const b = await t.action(api.containers.postCharges, {
			sessionToken: adaeze,
			containerId: capped,
			damageUnits: toUnits('500').toString()
		});
		expect([b.chargeUnits, b.refundUnits]).toEqual([toUnits('1200').toString(), '0']);
		expect(b.cappedByDeposit).toBe(true);

		// Negative damage is rejected.
		await t.mutation(api.containers.recordReturn, {
			sessionToken: adaeze,
			containerId: late,
			eirNumber: 'EIR-A3',
			depot: 'Apapa'
		});
		await rejects(
			t.action(api.containers.postCharges, {
				sessionToken: adaeze,
				containerId: late,
				damageUnits: '-5'
			}),
			/./
		);
	});

	it('post for review, then the importer accepts', async () => {
		const t = await seeded();
		const adaeze = await signIn(t, 'Adaeze Okafor');
		const carlo = await signIn(t, 'Carlo Reyes');
		const { containerIds } = await releasedHeld(
			t,
			adaeze,
			carlo,
			await orgId(t, 'Pasig Valley Imports'),
			['40GP']
		);
		const [id] = containerIds;
		await t.mutation(api.containers.recordReturn, {
			sessionToken: adaeze,
			containerId: id,
			eirNumber: 'EIR-P1',
			depot: 'Apapa'
		});
		const posted = await t.action(api.containers.postCharges, {
			sessionToken: adaeze,
			containerId: id,
			damageUnits: toUnits('200').toString(),
			note: 'Scuffed door',
			settleNow: false
		});
		expect(posted.status).toBe('posted');
		let c = await t.query(api.containers.get, { sessionToken: carlo, containerId: id });
		expect(c.container.state).toBe('returned');
		expect(c.container.damageUnits).toBe(toUnits('200').toString());
		await rejects(
			t.action(api.containers.acceptCharges, { sessionToken: adaeze, containerId: id }),
			/FORBIDDEN/
		);
		const accepted = await t.action(api.containers.acceptCharges, {
			sessionToken: carlo,
			containerId: id
		});
		expect(accepted.status).toBe('settled');
		expect(accepted.finalityMs).toBeGreaterThanOrEqual(450);
		c = await t.query(api.containers.get, { sessionToken: carlo, containerId: id });
		expect(c.container.chargesUnits).toBe(toUnits('200').toString());
		expect(c.container.refundUnits).toBe(toUnits('1800').toString());
	});

	it('settleMany settles several returned containers in ONE transaction', async () => {
		const t = await seeded();
		const adaeze = await signIn(t, 'Adaeze Okafor');
		const carlo = await signIn(t, 'Carlo Reyes');
		const { containerIds } = await releasedHeld(
			t,
			adaeze,
			carlo,
			await orgId(t, 'Pasig Valley Imports'),
			['20GP', '40GP', '40HC']
		);
		for (const id of containerIds) {
			await t.mutation(api.containers.recordReturn, {
				sessionToken: adaeze,
				containerId: id,
				eirNumber: `EIR-${id.slice(-4)}`,
				depot: 'Apapa'
			});
		}
		const r = await t.action(api.containers.settleMany, { sessionToken: adaeze, containerIds });
		expect(r.settled).toBe(3);
		expect(r.finalityMs).toBeGreaterThanOrEqual(450);
		expect(r.outcomes.every((o) => (o.finalityMs ?? 0) >= 450)).toBe(true);
		const hashes = new Set<string>();
		for (const id of containerIds) {
			const c = await t.query(api.containers.get, { sessionToken: carlo, containerId: id });
			expect(c.container.state).toBe('settled');
			expect(c.container.refundUnits).toBe(c.container.depositUnits);
			for (const p of c.payments.filter((p) => p.kind === 'refund')) hashes.add(p.txHash);
		}
		expect(hashes.size).toBe(1);
	});
});

describe('disputes', () => {
	it('only the disputed amount stays held; the resolver splits it', async () => {
		const t = await seeded();
		const tunde = await signIn(t, 'Tunde Bakare');
		const adaeze = await signIn(t, 'Adaeze Okafor');
		const desk = await signIn(t, 'Resolution Desk');
		const returned = (
			await t.query(api.containers.listForImporter, {
				sessionToken: tunde,
				filter: { states: ['returned'] }
			})
		)[0];

		await rejects(
			t.action(api.disputes.open, {
				sessionToken: tunde,
				containerId: returned._id,
				disputedUnits: toUnits('500').toString(),
				reason: 'Too high'
			}),
			/INVALID/
		);
		const opened = await t.action(api.disputes.open, {
			sessionToken: tunde,
			containerId: returned._id,
			disputedUnits: toUnits('50').toString(),
			reason: 'Returned on the last free day'
		});
		expect(opened.status).toBe('disputed');
		expect(opened.finalityMs).toBeGreaterThanOrEqual(450);
		// undisputed charge 30.00 to the line, 50.00 held, refund 2120.00 immediately
		expect(opened.chargeUnits).toBe(toUnits('80').toString());
		expect(opened.refundUnits).toBe(toUnits('2120').toString());
		let c = await t.query(api.containers.get, { sessionToken: tunde, containerId: returned._id });
		expect(c.container.state).toBe('disputed');
		expect(c.container.escrowUnits).toBe(toUnits('50').toString());
		expect(c.payments.filter((p) => p.kind === 'charge').map((p) => p.amountUnits)).toEqual([
			toUnits('30').toString()
		]);
		expect(c.payments.filter((p) => p.kind === 'refund').map((p) => p.amountUnits)).toEqual([
			toUnits('2120').toString()
		]);

		// Once only.
		await rejects(
			t.action(api.disputes.open, {
				sessionToken: tunde,
				containerId: returned._id,
				disputedUnits: toUnits('10').toString(),
				reason: 'again'
			}),
			/INVALID_STATE|CONFLICT/
		);

		// The line cannot decide a dispute the platform resolves.
		const list = await t.query(api.disputes.list, { sessionToken: desk, status: 'open' });
		const dispute = list.find((d) => d.containerId === returned._id)!;
		expect(dispute.canResolve).toBe(true);
		await rejects(
			t.action(api.disputes.resolve, {
				sessionToken: adaeze,
				disputeId: dispute._id,
				toLineUnits: '0',
				note: 'x'
			}),
			/FORBIDDEN/
		);
		await rejects(
			t.action(api.disputes.resolve, {
				sessionToken: desk,
				disputeId: dispute._id,
				toLineUnits: toUnits('60').toString(),
				note: 'x'
			}),
			/INVALID/
		);
		const res = await t.action(api.disputes.resolve, {
			sessionToken: desk,
			disputeId: dispute._id,
			toLineUnits: toUnits('20').toString(),
			note: 'Half day granted'
		});
		expect(res.finalityMs).toBeGreaterThanOrEqual(450);
		expect([res.toLineUnits, res.toImporterUnits]).toEqual([
			toUnits('20').toString(),
			toUnits('30').toString()
		]);
		c = await t.query(api.containers.get, { sessionToken: tunde, containerId: returned._id });
		expect(c.container.state).toBe('settled');
		expect(c.container.chargesUnits).toBe(toUnits('50').toString());
		expect(c.container.refundUnits).toBe(toUnits('2150').toString());
		expect(c.dispute!.status).toBe('resolved');
		await rejects(
			t.action(api.disputes.resolve, {
				sessionToken: desk,
				disputeId: dispute._id,
				toLineUnits: '0',
				note: 'again'
			}),
			/INVALID_STATE/
		);
	});

	it('the seeded dispute is waiting for the resolver, with its amount held', async () => {
		const t = await seeded();
		const carlo = await signIn(t, 'Carlo Reyes');
		const list = await t.query(api.disputes.list, { sessionToken: carlo, status: 'open' });
		expect(list).toHaveLength(1);
		expect(list[0].escrowUnits).toBe(toUnits('500').toString());
		const dash = await t.query(api.dashboard.importer, { sessionToken: carlo });
		expect(dash.disputed).toBe(1);
	});
});

describe('silent line rule', () => {
	it('the importer can submit the receipt after the grace period; the line can contest', async () => {
		const t = await seeded();
		const carlo = await signIn(t, 'Carlo Reyes');
		const adaeze = await signIn(t, 'Adaeze Okafor');
		const target = (
			await t.query(api.containers.listForImporter, {
				sessionToken: carlo,
				filter: { states: ['in_detention'] }
			})
		).find((c) => c.mode === 'held')!;
		const now = (await t.query(api.system.status, {})).simNow;
		// Returned two hours ago: the line still has time.
		await rejects(
			t.mutation(api.containers.submitReturnReceipt, {
				sessionToken: carlo,
				containerId: target._id,
				eirNumber: 'EIR-S1',
				depot: 'Apapa',
				date: now - 2 * 3_600_000
			}),
			/NOT_ELIGIBLE/
		);
		// The line cannot be impersonated.
		await rejects(
			t.mutation(api.containers.submitReturnReceipt, {
				sessionToken: adaeze,
				containerId: target._id,
				eirNumber: 'EIR-S1',
				depot: 'Apapa',
				date: now - 2 * DAY
			}),
			/FORBIDDEN/
		);
		const sub = await t.mutation(api.containers.submitReturnReceipt, {
			sessionToken: carlo,
			containerId: target._id,
			eirNumber: 'EIR-S1',
			depot: 'Apapa',
			date: now - 2 * DAY
		});
		expect(sub.state).toBe('returned');
		expect(sub.returnReceipt!.submittedBy).toBe('importer');
		expect(sub.settlementWindowEndsAt! - now).toBeGreaterThan(2.9 * DAY);
		// The line contests inside the window: back in detention.
		const back = await t.mutation(api.containers.contestReturnReceipt, {
			sessionToken: adaeze,
			containerId: target._id,
			note: 'Not our depot'
		});
		expect(back.state).toBe('in_detention');
		expect(back.returnReceipt).toBeNull();
		// Importer submits again; the line stays silent; the refund proceeds when the window ends.
		await t.mutation(api.containers.submitReturnReceipt, {
			sessionToken: carlo,
			containerId: target._id,
			eirNumber: 'EIR-S2',
			depot: 'Apapa',
			date: now - 2 * DAY
		});
		await t.action(api.demo.advanceClock, { sessionToken: adaeze, ms: 3 * DAY + 60_000 });
		const c = await t.query(api.containers.get, { sessionToken: carlo, containerId: target._id });
		expect(c.container.state).toBe('settled');
		// Detention counted only up to the return date: day 1 after free time (0.6 days late).
		expect(c.container.chargesUnits).toBe(toUnits('75').toString());
		expect(c.container.refundUnits).toBe(toUnits('1925').toString());
	});

	it('the line cannot contest a receipt it recorded itself', async () => {
		const t = await seeded();
		const adaeze = await signIn(t, 'Adaeze Okafor');
		const returned = (
			await t.query(api.containers.listForLine, {
				sessionToken: adaeze,
				filter: { states: ['returned'] }
			})
		)[0];
		await rejects(
			t.mutation(api.containers.contestReturnReceipt, {
				sessionToken: adaeze,
				containerId: returned._id
			}),
			/INVALID_STATE/
		);
	});

	it('return date validation', async () => {
		const t = await seeded();
		const adaeze = await signIn(t, 'Adaeze Okafor');
		const tunde = await signIn(t, 'Tunde Bakare');
		const hv = await orgId(t, 'Harbourview Foods Ltd');
		const { containerIds } = await releasedHeld(t, adaeze, tunde, hv, ['20GP']);
		const now = (await t.query(api.system.status, {})).simNow;
		await rejects(
			t.mutation(api.containers.recordReturn, {
				sessionToken: adaeze,
				containerId: containerIds[0],
				eirNumber: 'E',
				depot: 'D',
				date: now + DAY
			}),
			/future/
		);
		await rejects(
			t.mutation(api.containers.recordReturn, {
				sessionToken: adaeze,
				containerId: containerIds[0],
				eirNumber: 'E',
				depot: 'D',
				date: now - DAY
			}),
			/before the container was released/
		);
		await rejects(
			t.mutation(api.containers.recordReturn, {
				sessionToken: adaeze,
				containerId: containerIds[0],
				eirNumber: ' ',
				depot: 'D'
			}),
			/EIR/
		);
		const r = await newRequest(t, adaeze, hv, ['20GP']);
		await rejects(
			t.mutation(api.containers.recordReturn, {
				sessionToken: adaeze,
				containerId: r.containerIds[0],
				eirNumber: 'E',
				depot: 'D'
			}),
			/cannot be recorded/
		);
		void internal;
		void demoApproval;
	});
});

describe('failure handling', () => {
	it('a chain failure leaves the container pending, never half-settled; the sweep retries what the line posted', async () => {
		const t = await seeded();
		const adaeze = await signIn(t, 'Adaeze Okafor');
		const carlo = await signIn(t, 'Carlo Reyes');
		const { containerIds } = await releasedHeld(
			t,
			adaeze,
			carlo,
			await orgId(t, 'Pasig Valley Imports'),
			['20GP']
		);
		const [id] = containerIds;
		await t.mutation(api.containers.recordReturn, {
			sessionToken: adaeze,
			containerId: id,
			eirNumber: 'EIR-F1',
			depot: 'Apapa'
		});
		// The guard receipt vanishes from the chain for a moment (stands in for an RPC outage).
		const receipt = await t.run(async (ctx) => {
			const c = await ctx.db.get(id);
			const row = (await ctx.db.query('sim_receipts').collect()).find(
				(r) => r.recipient === c!.depositAddress
			)!;
			const copy = { ...row };
			await ctx.db.delete(row._id);
			return copy;
		});
		const {
			_id: _drop,
			_creationTime: _t,
			...rest
		} = receipt as typeof receipt & { _id?: unknown; _creationTime?: unknown };
		void _drop;
		void _t;
		await rejects(
			t.action(api.containers.postCharges, {
				sessionToken: adaeze,
				containerId: id,
				damageUnits: toUnits('120').toString(),
				note: 'Cracked panel'
			}),
			/InvalidReceipt|Unknown receipt/
		);
		let c = await t.query(api.containers.get, { sessionToken: carlo, containerId: id });
		expect(c.container.state).toBe('returned');
		expect(c.container.pendingOnChain).toBeTruthy();
		expect(c.container.pendingOnChainFlag).toBe(true);
		expect(c.payments.map((p) => p.kind)).toEqual(['deposit']); // nothing shown as paid or refunded
		expect(c.events.at(-1)!.kind).toBe('settle_failed');

		// The chain recovers; the sweep retries with the damage the line already posted.
		await t.run(async (ctx) => {
			await ctx.db.insert('sim_receipts', rest as never);
		});
		const adv = await t.action(api.demo.advanceClock, { sessionToken: adaeze, ms: 60_000 });
		expect(adv.sweep.settled).toBeGreaterThanOrEqual(1);
		c = await t.query(api.containers.get, { sessionToken: carlo, containerId: id });
		expect(c.container.state).toBe('settled');
		expect(c.container.chargesUnits).toBe(toUnits('120').toString());
		expect(c.container.pendingOnChain).toBeUndefined();
		expect(c.payments.map((p) => p.kind)).toEqual(['deposit', 'charge', 'refund']);
	});
});
