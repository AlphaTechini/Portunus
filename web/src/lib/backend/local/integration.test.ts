// @vitest-environment node
/**
 * Loads the REAL Convex modules from src/convex through the emulator and exercises them.
 * Skips gracefully while the backend is incomplete (no seed.ensure yet).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { anyApi } from 'convex/server';
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
const rt = new LocalRuntime({
	modules,
	leader: 'always',
	storage: memoryStorage(),
	createChannel: null,
	persistDebounceMs: 0,
	log: (level, ...a) => {
		if (level !== 'info') warnings.push([level, ...a]);
	}
});
afterAll(() => rt.dispose());

describe('real convex modules', () => {
	it('loads without errors and registers functions', async () => {
		await rt.ready;
		expect(warnings).toEqual([]);
		expect(rt.functions.size).toBeGreaterThan(0);
		expect(rt.functions.has('tempoNode:health')).toBe(false); // "use node" file never loaded
	});

	it.runIf(hasBackend)('seeds, lists demo personas, signs in and reads dashboards', async () => {
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
		const impSession = (await rt.mutation(api.auth.signInAsDemo, { userId: importer.userId })) as any;

		const me = (await rt.query(api.auth.me, { sessionToken: lineSession.sessionToken })) as any;
		expect(me.org.kind).toBe('line');

		const lineDash = (await rt.query(api.dashboard.line, { sessionToken: lineSession.sessionToken })) as any;
		expect(lineDash).toBeTruthy();
		const impDash = (await rt.query(api.dashboard.importer, { sessionToken: impSession.sessionToken })) as any;
		expect(impDash).toBeTruthy();

		// unauthenticated access is rejected with a ConvexError carrying a code
		await expect(rt.query(api.dashboard.line, { sessionToken: 'bogus' })).rejects.toMatchObject({
			data: { code: 'UNAUTHENTICATED' }
		});
	});
});
