import { expect, test, type Page } from '@playwright/test';
import { PERSONAS, signInAs, type PersonaKey } from './helpers';

/**
 * Skeptical-user smoke test: sign in as every demo persona, open every sidebar item (and the first
 * row of each list), and fail on anything a user would call broken: an uncaught exception, a console
 * error, a failed request, an error state, a page stuck on skeletons, or text that is obviously
 * wrong ("undefined", "NaN", a space before a comma).
 */
const NAMES: Record<PersonaKey, string> = {
	adaeze: 'Adaeze (shipping line, Meridian)',
	tunde: 'Tunde (importer, Harbourview)',
	wanjiru: 'Wanjiru (deposit-free importer, Savanna)',
	carlo: 'Carlo (importer, Pasig Valley)',
	joseph: 'Joseph (shipping line, Kestrel)',
	resolution: 'Resolver (platform)'
};

/** What the page may never show. Each is a sign of a bug, not a state. */
const BAD_TEXT: [RegExp, string][] = [
	[/\bundefined\b/i, 'the word "undefined"'],
	[/\bNaN\b/, '"NaN"'],
	[/\[object Object\]/, '"[object Object]"'],
	[/\bInfinity\b/, '"Infinity"'],
	[/\bnull\b/, 'the word "null"'],
	[/\$-\d/, 'a negative dollar amount'],
	[/(?<=\S)[ \u00a0]+[,;.](?=\s|$)/, 'whitespace before punctuation'],
	[/did not load|something went wrong|unexpected error|internal server error/i, 'an error message']
];

interface Problems {
	list: string[];
}

function watch(page: Page): Problems {
	const problems: Problems = { list: [] };
	page.on('pageerror', (e) => problems.list.push(`uncaught exception: ${e.message}`));
	page.on('console', (m) => {
		if (m.type() === 'error') problems.list.push(`console error: ${m.text()}`);
	});
	page.on('requestfailed', (r) => {
		// Navigations that are cancelled by the next click are not failures.
		if (!/ERR_ABORTED/.test(r.failure()?.errorText ?? '')) {
			problems.list.push(`request failed: ${r.url()} (${r.failure()?.errorText})`);
		}
	});
	page.on('response', (r) => {
		if (r.status() >= 400) problems.list.push(`HTTP ${r.status()}: ${r.url()}`);
	});
	return problems;
}

/** The page has rendered: a heading, no skeletons, no error states, nothing obviously wrong. */
async function audit(page: Page, problems: Problems, where: string) {
	const main = page.locator('main');
	await expect(main.getByRole('heading', { level: 1 }), `${where}: heading`).toBeVisible();
	await expect(main.locator('.sk:visible'), `${where}: still loading`).toHaveCount(0);
	// Let live queries and entrance animations settle before reading text.
	await page.waitForTimeout(350);

	await expect(page.locator('[role="alert"]'), `${where}: error state on screen`).toHaveCount(0);
	const text = (await main.innerText()).replace(/[ \t]+\n/g, '\n');
	for (const [re, what] of BAD_TEXT) {
		const m = text.match(re);
		expect(
			m,
			`${where}: ${what} in "${m ? text.slice(Math.max(0, m.index! - 40), m.index! + 40) : ''}"`
		).toBeNull();
	}
	// Horizontal scroll at desktop width means something overflows its card.
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(overflow, `${where}: page scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(0);

	expect(problems.list.splice(0), `${where}: console, network or page errors`).toEqual([]);
}

async function navHrefs(page: Page): Promise<{ label: string; href: string }[]> {
	const links = page.getByRole('navigation', { name: 'Main' }).first().getByRole('link');
	return links.evaluateAll((els) =>
		els
			.map((a) => ({
				label: (a.textContent ?? '').replace(/\s+/g, ' ').trim(),
				href: a.getAttribute('href') ?? ''
			}))
			.filter((l) => l.href.startsWith('/'))
	);
}

for (const key of Object.keys(PERSONAS) as PersonaKey[]) {
	test(`smoke: every page for ${NAMES[key]}`, async ({ page }) => {
		const problems = watch(page);
		await signInAs(page, key);
		await audit(page, problems, `${key} home`);
		await expect(page).toHaveURL(new RegExp(`${PERSONAS[key].home}$`));

		const items = await navHrefs(page);
		expect(items.length, `${key}: sidebar items`).toBeGreaterThan(1);
		const visited: string[] = [];

		for (const item of items) {
			// Click the link in the sidebar, as a user does.
			await page
				.getByRole('navigation', { name: 'Main' })
				.first()
				.getByRole('link', { name: new RegExp(`^${item.label.replace(/\s*\d+$/, '')}`) })
				.first()
				.click();
			await expect(page).toHaveURL(new RegExp(`${item.href.replace(/\//g, '\\/')}(\\?.*)?$`));
			await audit(page, problems, `${key} ${item.label} (${item.href})`);
			visited.push(item.href);

			// Open the first row of a list, then come back.
			const rowLink = page.locator('main').getByRole('row').nth(1).getByRole('link').first();
			if (await rowLink.count()) {
				const before = page.url();
				await rowLink.click();
				await expect(page).not.toHaveURL(before);
				await audit(page, problems, `${key} ${item.label}, first row (${page.url()})`);
				await page.goBack();
				await expect(page).toHaveURL(before);
				await audit(page, problems, `${key} ${item.label}, back`);
			}
		}

		// Every sidebar destination was reached and the shell stayed signed in.
		expect(visited).toEqual(items.map((i) => i.href));
		await expect(page.getByRole('banner')).toContainText(PERSONAS[key].org);
	});
}

test('smoke: the public pages and an unknown route behave', async ({ page }) => {
	const problems = watch(page);
	await page.goto('/');
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	await page.waitForTimeout(400);
	expect(problems.list.splice(0), 'landing').toEqual([]);

	await page.goto('/signin');
	await expect(page.getByRole('heading', { name: 'Sign in to Portunus' })).toBeVisible();
	expect(problems.list.splice(0), 'signin').toEqual([]);

	// An app route without a session sends the visitor to sign in, not to an error.
	await page.goto('/line');
	await expect(page).toHaveURL(/\/signin/);
	expect(problems.list.splice(0), 'redirect to signin').toEqual([]);
});
