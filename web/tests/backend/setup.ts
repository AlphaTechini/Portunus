/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { vi } from 'vitest';
import schema from '../../src/convex/schema';
import { api, internal } from '../../src/convex/_generated/api';
import type { Id } from '../../src/convex/_generated/dataModel';

export const modules = import.meta.glob('../../src/convex/**/*.ts');

export { api, internal };
export type TestConvex = ReturnType<typeof newBackend>;

/** Fresh in-memory backend. Sim finality sleeps are off so tests are instant. */
export function newBackend(overrides: Record<string, () => Promise<unknown>> = {}) {
	process.env.TEMPO_MODE = 'sim';
	process.env.SIM_FINALITY_SLEEP = 'off';
	process.env.DEMO_MODE = 'on';
	return convexTest(schema, { ...modules, ...overrides });
}

export async function seeded() {
	vi.useFakeTimers();
	const t = newBackend();
	await t.mutation(api.seed.ensure, {});
	return t;
}

/** Sign in as a seeded demo persona by name. */
export async function signIn(t: TestConvex, name: string): Promise<string> {
	const personas = await t.query(api.auth.listDemoPersonas, {});
	const p = personas.find((x) => x.name === name);
	if (!p) throw new Error(`No persona ${name}`);
	const { sessionToken } = await t.mutation(api.auth.signInAsDemo, {
		userId: p.userId as Id<'users'>
	});
	return sessionToken;
}

export const DAY = 86_400_000;
export const demoApproval = { method: 'demo' as const };

import { generateContainerNumber } from '../../src/lib/shared/domain/containerNumber';

let serial = 700000;
export const freshNumber = (prefix = 'MRDU') => generateContainerNumber(prefix, serial++);

export async function orgId(t: TestConvex, name: string): Promise<Id<'organizations'>> {
	return t.run(async (ctx) => {
		const orgs = await ctx.db.query('organizations').collect();
		const o = orgs.find((x) => x.name === name);
		if (!o) throw new Error(`No org ${name}`);
		return o._id;
	});
}

export async function newRequest(
	t: TestConvex,
	line: string,
	importer: Id<'organizations'>,
	types: ('20GP' | '40GP' | '40HC' | '20RF' | '40RF')[],
	mode: 'held' | 'depositFree' = 'held'
) {
	const r = await t.mutation(api.releaseRequests.create, {
		sessionToken: line,
		importerOrgId: importer,
		billOfLading: `MRDNLOS${Math.floor(Math.random() * 90000 + 10000)}`,
		portOfDischarge: 'Apapa, Lagos',
		mode,
		containers: types.map((type) => ({ number: freshNumber(), type }))
	});
	return r;
}

/** Create a held request, pay it, release it. Returns ids. */
export async function releasedHeld(
	t: TestConvex,
	line: string,
	importerToken: string,
	importer: Id<'organizations'>,
	types: ('20GP' | '40GP' | '40HC' | '20RF' | '40RF')[]
) {
	const r = await newRequest(t, line, importer, types);
	await t.action(api.deposits.payBatch, {
		sessionToken: importerToken,
		requestId: r.requestId,
		approval: demoApproval
	});
	const rel = await t.mutation(api.releaseRequests.issueReleaseOrder, {
		sessionToken: line,
		requestId: r.requestId
	});
	return { requestId: r.requestId, containerIds: rel.released };
}
