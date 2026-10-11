import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, seeded, signIn } from './setup';

afterEach(() => vi.useRealTimers());

async function numberOf(
	t: Awaited<ReturnType<typeof seeded>>,
	pick: (c: { state: string; importerOrgId: string }) => boolean
) {
	return t.run(async (ctx) => {
		const all = await ctx.db.query('containers').collect();
		const c = all.find((x) => pick(x));
		if (!c) throw new Error('no such container in the seed');
		return { number: c.number, id: c._id };
	});
}

describe('containers.byNumber', () => {
	it('returns the same detail as containers.get to the line and the importer of the container', async () => {
		const t = await seeded();
		const adaeze = await signIn(t, 'Adaeze Okafor');
		const wanjiru = await signIn(t, 'Wanjiru Mwangi');
		const detention = await t.run(async (ctx) => {
			const all = await ctx.db.query('containers').collect();
			const c = all.find((x) => x.state === 'in_detention' && x.mode === 'depositFree');
			if (!c) throw new Error('seed has no deposit-free container in detention');
			return c;
		});

		const viaLine = await t.query(api.containers.byNumber, {
			sessionToken: adaeze,
			number: detention.number
		});
		const viaImporter = await t.query(api.containers.byNumber, {
			sessionToken: wanjiru,
			number: detention.number
		});
		expect(viaLine).not.toBeNull();
		expect(viaImporter).not.toBeNull();
		const byId = await t.query(api.containers.get, {
			sessionToken: adaeze,
			containerId: detention._id
		});
		expect(viaLine!.container._id).toBe(detention._id);
		expect(viaLine!.payments.map((p) => p._id)).toEqual(byId.payments.map((p) => p._id));
		expect(viaImporter!.container._id).toBe(detention._id);
		expect(viaLine!.accessKey?.status).toBe('active');
		// Secrets never leave the backend.
		expect(JSON.stringify(viaLine)).not.toContain('encPrivKey');
	});

	it('accepts a formatted number and is case-insensitive', async () => {
		const t = await seeded();
		const adaeze = await signIn(t, 'Adaeze Okafor');
		const { number } = await numberOf(t, (c) => c.state === 'in_free_time');
		const pretty = `${number.slice(0, 4)} ${number.slice(4, 10)}-${number.slice(10)}`.toLowerCase();
		const d = await t.query(api.containers.byNumber, { sessionToken: adaeze, number: pretty });
		expect(d?.container.number).toBe(number);
	});

	it('reads as not found for another importer and for another line', async () => {
		const t = await seeded();
		const joseph = await signIn(t, 'Joseph Otieno');
		const carlo = await signIn(t, 'Carlo Reyes');
		// A Harbourview container, seen by Pasig Valley's persona.
		const harbourview = await t.run(async (ctx) => {
			const orgs = await ctx.db.query('organizations').collect();
			const id = orgs.find((o) => o.name === 'Harbourview Foods Ltd')!._id;
			const all = await ctx.db.query('containers').collect();
			return all.find((c) => c.importerOrgId === id && c.state === 'in_free_time')!;
		});
		expect(
			await t.query(api.containers.byNumber, { sessionToken: carlo, number: harbourview.number })
		).toBeNull();
		expect(
			await t.query(api.containers.byNumber, {
				sessionToken: joseph,
				number: harbourview.number
			})
		).toBeNull();
		expect(
			await t.query(api.containers.byNumber, { sessionToken: carlo, number: 'NOPE0000000' })
		).toBeNull();
	});

	it('lets the platform resolver open disputed containers only', async () => {
		const t = await seeded();
		const desk = await signIn(t, 'Resolution Desk');
		const disputed = await numberOf(t, (c) => c.state === 'disputed');
		const calm = await numberOf(t, (c) => c.state === 'in_free_time');

		const d = await t.query(api.containers.byNumber, {
			sessionToken: desk,
			number: disputed.number
		});
		expect(d?.container.state).toBe('disputed');
		expect(d?.dispute?.status).toBe('open');
		const viaId = await t.query(api.containers.get, {
			sessionToken: desk,
			containerId: disputed.id
		});
		expect(viaId.container._id).toBe(disputed.id);

		expect(
			await t.query(api.containers.byNumber, { sessionToken: desk, number: calm.number })
		).toBeNull();
		await expect(
			t.query(api.containers.get, { sessionToken: desk, containerId: calm.id })
		).rejects.toMatchObject({ data: { code: 'NOT_FOUND' } });
	});

	it('requires a session', async () => {
		const t = await seeded();
		await expect(
			t.query(api.containers.byNumber, { sessionToken: 'nope', number: 'MRDU1234565' })
		).rejects.toMatchObject({ data: { code: 'UNAUTHENTICATED' } });
	});
});
