import { expect, type Page } from '@playwright/test';
import { generateContainerNumber } from '../src/lib/shared/domain/containerNumber';

/** A valid ISO 6346 number owned by Meridian (MRDU), unique per serial. */
export const mrdu = (serial: number) => generateContainerNumber('MRDU', serial);

/**
 * Run a backend function inside the page (the local runtime lives in the browser) as a demo
 * persona, by name. Used to play the importer's side without a second browser session.
 */
export async function backendAs<T = unknown>(
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

/** Fill and submit the new request form as the signed-in line. Resolves on the request page. */
export async function createRequest(
	page: Page,
	opts: { importer: string; billOfLading: string; numbers: string[] }
): Promise<string> {
	await page.goto('/line/requests/new');
	const select = page.getByRole('combobox', { name: /Importer/ }).first();
	await expect(select.locator('option', { hasText: opts.importer })).toHaveCount(1);
	const value = await select.locator('option', { hasText: opts.importer }).getAttribute('value');
	await select.selectOption(value!);
	await page.getByRole('textbox', { name: 'Bill of lading' }).fill(opts.billOfLading);
	for (const [i, n] of opts.numbers.entries()) {
		if (i > 0) await page.getByRole('button', { name: 'Add container' }).click();
		await page.getByLabel(`Container number, row ${i + 1}`).fill(n);
	}
	await page.getByRole('button', { name: 'Create request and generate addresses' }).click();
	await expect(page).toHaveURL(/\/line\/requests\/[^/]+\?new=1/);
	return page.url().split('/line/requests/')[1].split('?')[0];
}
