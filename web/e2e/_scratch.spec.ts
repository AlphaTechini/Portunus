import { test } from '@playwright/test';
import { signInAs } from './helpers';
import { findContainer } from './fe3-helpers';
test('scratch', async ({ page }) => {
	await signInAs(page, 'adaeze');
	const c = await findContainer(page, 'Adaeze Okafor', { state: 'in_detention', mode: 'depositFree' });
	await page.goto(`/containers/${c.number}`);
	await page.waitForTimeout(1500);
	const h = await page.getByText('payable only to').first().locator('xpath=..').evaluate((e) => e.outerHTML);
	console.log(h);
	const body = await page.locator('main').textContent();
	for (const m of body!.matchAll(/\s[,.;:]/g)) console.log('WS-PUNCT', JSON.stringify(body!.slice(Math.max(0,m.index!-30), m.index!+20)));
});
