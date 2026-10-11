// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Loads the REAL Convex modules from src/convex through the emulator and exercises them.
 * Skips gracefully while the backend is incomplete (no seed.ensure yet).
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { anyApi, mutationGeneric } from 'convex/server';
import { LocalRuntime, type ModuleMap } from './runtime.js';
import { memoryStorage } from './__fixtures__/helpers.js';

const api = anyApi as any;

const modules = import.meta.glob([
	'../../../convex/**/*.ts',
	'!../../../convex/**/_generated/**',
	'!../../../convex/**/*.d.ts',
	'!../../../convex/**/*.test.ts',
	'!../../../convex/**/*Node.ts'
]) as ModuleMap;

const names = Object.keys(modules).map((k) => k.split('/convex/')[1]);
const hasBackend = names.includes('seed.ts') && names.includes('auth.ts');

const warnings: unknown[][] = [];
const all: LocalRuntime[] = [];
function newRuntime(extra: ModuleMap = {}) {
	const r = new LocalRuntime({
		modules: { ...modules, ...extra },
		leader: 'always',
		storage: memoryStorage(),
		createChannel: null,
		persistDebounceMs: 0,
		log: (level, ...a) => {
			if (level !== 'info') warnings.push([level, ...a]);
		}
	});
	all.push(r);
	return r;
}
afterAll(() => all.forEach((r) => r.dispose()));

// Test-only helper: turn registered passkey users into demo users so they can approve with method 'demo'.
const probe = {
	makeDemo: mutationGeneric({
		args: {},
		handler: async (ctx) => {
			for (const u of await ctx.db.query('users').collect())
				await ctx.db.patch(u._id, { demo: true, passkey: undefined });
		}
	})
};

describe('real convex modules', () => {
	it('loads without errors and registers functions', async () => {
		const rt = newRuntime();
		await rt.ready;
		expect(warnings).toEqual([]);
		expect(rt.functions.size).toBeGreaterThan(0);
		expect(rt.functions.has('tempoNode:health')).toBe(false); // "use node" file never loaded
	});

	it.runIf(hasBackend)('runs the real crons and scheduled functions without errors', async () => {
		vi.useFakeTimers();
		try {
			warnings.length = 0;
			const rt = newRuntime();
			await rt.ready;
			await rt.mutation(api.seed.ensure, {});
			await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000); // 3h: interval crons + due scheduled steps
			expect(warnings).toEqual([]);
			expect(Object.keys(rt.store.cronLastRun).length).toBeGreaterThan(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it.runIf(hasBackend)(
		'runs the full held-deposit lifecycle on the sim chain without seed data',
		async () => {
			const rt = newRuntime({ 'probe.ts': probe as never });
			await rt.ready;
			const { generateContainerNumber } = await import('../../shared/domain/containerNumber.js');
			const hex = (n: number, seed: string) => seed.repeat(n).slice(0, n);
			const reg = async (orgKind: 'line' | 'importer', name: string, orgName: string, n: string) =>
				(
					(await rt.mutation(api.auth.registerPasskey, {
						name,
						orgName,
						orgKind,
						country: 'Nigeria',
						credentialId: `cred-${n}`,
						publicKey: hex(128, n),
						address: `0x${hex(40, n)}`
					})) as { sessionToken: string }
				).sessionToken;
			const lineTok = await reg('line', 'Lena Line', 'Testline Shipping', 'a');
			const impTok = await reg('importer', 'Ivan Importer', 'Testimport Ltd', 'b');
			const lineMe = (await rt.query(api.auth.me, { sessionToken: lineTok })) as any;
			const impMe = (await rt.query(api.auth.me, { sessionToken: impTok })) as any;
			expect(lineMe.org.kind).toBe('line');
			await rt.mutation(api.probe.makeDemo, {});

			const number = generateContainerNumber(lineMe.org.containerPrefix ?? 'TSTU', 123456);
			const created = (await rt.mutation(api.releaseRequests.create, {
				sessionToken: lineTok,
				importerOrgId: impMe.org._id,
				billOfLading: 'BL-TEST-1',
				portOfDischarge: 'Apapa, Lagos',
				mode: 'held',
				containers: [{ number, type: '20GP' }]
			})) as any;
			expect(created.containerIds).toHaveLength(1);

			const paid = await rt.action(api.deposits.payBatch, {
				sessionToken: impTok,
				requestId: created.requestId,
				approval: { method: 'demo' }
			});
			expect(paid).toBeTruthy();
			let c = (await rt.query(api.containers.get, {
				sessionToken: lineTok,
				containerId: created.containerIds[0]
			})) as any;
			expect(c.container.state).toBe('deposit_held');

			await rt.mutation(api.releaseRequests.issueReleaseOrder, {
				sessionToken: lineTok,
				requestId: created.requestId
			});
			c = (await rt.query(api.containers.get, {
				sessionToken: lineTok,
				containerId: created.containerIds[0]
			})) as any;
			expect(c.container.state).toBe('in_free_time');

			// Move the product clock past free time: the sweep must put it into detention.
			await rt.action(api.demo.advanceClock, { sessionToken: lineTok, ms: 9 * 24 * 3600 * 1000 });
			c = (await rt.query(api.containers.get, {
				sessionToken: lineTok,
				containerId: created.containerIds[0]
			})) as any;
			expect(c.container.state).toBe('in_detention');

			await rt.mutation(api.containers.recordReturn, {
				sessionToken: lineTok,
				containerId: created.containerIds[0],
				eirNumber: 'EIR-1',
				date: Date.now(),
				depot: 'Apapa Yard 3'
			});
			// Window end -> settlement by the sweep.
			await rt.action(api.demo.advanceClock, { sessionToken: lineTok, ms: 4 * 24 * 3600 * 1000 });
			c = (await rt.query(api.containers.get, {
				sessionToken: lineTok,
				containerId: created.containerIds[0]
			})) as any;
			expect(c.container.state).toBe('settled');
		}
	);

	it.runIf(hasBackend)('seeds, lists demo personas, signs in and reads dashboards', async () => {
		const rt = newRuntime();
		await rt.ready;
		await rt.mutation(api.seed.ensure, {});
		await rt.mutation(api.seed.ensure, {}); // idempotent

		const personas = (await rt.query(api.auth.listDemoPersonas, {})) as any[];
		expect(personas.length).toBeGreaterThanOrEqual(4);
		const line = personas.find((p) => p.orgKind === 'line' && /Meridian/.test(p.orgName));
		const importer = personas.find((p) => p.orgKind === 'importer');
		expect(line).toBeTruthy();
		expect(importer).toBeTruthy();

		const lineSession = (await rt.mutation(api.auth.signInAsDemo, { userId: line.userId })) as any;
		expect(typeof lineSession.sessionToken).toBe('string');
		const impSession = (await rt.mutation(api.auth.signInAsDemo, {
			userId: importer.userId
		})) as any;

		const me = (await rt.query(api.auth.me, { sessionToken: lineSession.sessionToken })) as any;
		expect(me.org.kind).toBe('line');

		const lineDash = (await rt.query(api.dashboard.line, {
			sessionToken: lineSession.sessionToken
		})) as any;
		expect(lineDash).toBeTruthy();
		const impDash = (await rt.query(api.dashboard.importer, {
			sessionToken: impSession.sessionToken
		})) as any;
		expect(impDash).toBeTruthy();

		// A broad read sweep over the seeded world: none of these may throw.
		const sweep: Array<[string, string]> = [
			['containers.listForLine', lineSession.sessionToken],
			['containers.listForImporter', impSession.sessionToken],
			['releaseRequests.listForLine', lineSession.sessionToken],
			['releaseRequests.listForImporter', impSession.sessionToken],
			['orgs.listImporters', lineSession.sessionToken],
			['orgs.lineSettings', lineSession.sessionToken],
			['rateCards.list', lineSession.sessionToken],
			['heldTransfers.list', lineSession.sessionToken],
			['disputes.list', lineSession.sessionToken],
			['notifications.list', impSession.sessionToken]
		];
		const failures: string[] = [];
		for (const [name, token] of sweep) {
			const [mod, fn] = name.split('.');
			try {
				const out = await rt.query(api[mod][fn], { sessionToken: token });
				expect(out).toBeDefined();
			} catch (e) {
				failures.push(`${name}: ${(e as Error).message}`);
			}
		}
		expect(failures).toEqual([]);
		const status = (await rt.query(api.system.status, {})) as any;
		expect(status.chainMode).toBe('sim');
		const listed = (await rt.query(api.containers.listForLine, {
			sessionToken: lineSession.sessionToken
		})) as any;
		expect((Array.isArray(listed) ? listed : (listed.containers ?? [])).length).toBeGreaterThan(5);

		// unauthenticated access is rejected with a ConvexError carrying a code
		await expect(rt.query(api.dashboard.line, { sessionToken: 'bogus' })).rejects.toMatchObject({
			data: { code: 'UNAUTHENTICATED' }
		});
	});
});
