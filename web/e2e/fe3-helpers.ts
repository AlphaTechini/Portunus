import type { Page } from '@playwright/test';
import { signInAs, type PersonaKey } from './helpers';

/**
 * Run a backend function from inside the page (the local runtime lives in the browser), signed in
 * as a demo persona by name. Used to arrange scenarios the UI of the other role would normally
 * create, such as the line posting charges for review.
 */
export async function backend<T = unknown>(
	page: Page,
	persona: string,
	kind: 'query' | 'mutation' | 'action',
	fn: string,
	args: Record<string, unknown> = {}
): Promise<T> {
	return page.evaluate(
		async ({ persona, kind, fn, args }) => {
			const { getBackend } = await import('/src/lib/backend/index.ts');
			const { api } = await import('/src/convex/_generated/api.js');
			const b = getBackend() as unknown as Record<
				string,
				(ref: unknown, a: unknown) => Promise<unknown>
			>;
			const personas = (await b.query(api.auth.listDemoPersonas, {})) as {
				userId: string;
				name: string;
			}[];
			const p = personas.find((x) => x.name === persona);
			if (!p) throw new Error(`No persona ${persona}`);
			const { sessionToken } = (await b.mutation(api.auth.signInAsDemo, {
				userId: p.userId
			})) as { sessionToken: string };
			const [mod, name] = fn.split('.');
			const ref = (api as unknown as Record<string, Record<string, unknown>>)[mod][name];
			return b[kind](ref, { ...args, sessionToken });
		},
		{ persona, kind, fn, args }
	) as Promise<T>;
}

export type ContainerRow = {
	_id: string;
	number: string;
	state: string;
	mode: string;
	importerName: string;
	requestId: string;
};

/** First container of a line that matches the predicate source (a JS function body over `c`). */
export async function findContainer(
	page: Page,
	line: string,
	match: { state: string; mode?: string; importer?: string }
): Promise<ContainerRow> {
	const rows = await backend<ContainerRow[]>(page, line, 'query', 'containers.listForLine', {});
	const c = rows.find(
		(r) =>
			r.state === match.state &&
			(!match.mode || r.mode === match.mode) &&
			(!match.importer || r.importerName === match.importer)
	);
	if (!c) throw new Error(`No ${match.state} container found for ${line}`);
	return c;
}

/** The approval sheet's confirm button, the same for every approval. */
export function approveSheet(page: Page) {
	return page.getByRole('dialog').filter({ has: page.getByText('Simulated approval') });
}

/** Sign out (drop the stored session) and sign in as another demo persona. */
export async function switchTo(page: Page, persona: PersonaKey, next?: string) {
	await page.evaluate(() => {
		localStorage.removeItem('portunus.session');
		sessionStorage.removeItem('portunus.session');
	});
	await signInAs(page, persona, next);
}
