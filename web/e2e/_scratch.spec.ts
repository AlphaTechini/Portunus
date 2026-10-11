import { test } from '@playwright/test';
test('scratch', async ({ page }) => {
	page.on('response', (r) => { if (r.status() >= 400) console.log('RESP', r.status(), r.url()); });
	page.on('console', (m) => { if (m.type()==='error') console.log('CONSOLE', m.text(), JSON.stringify(m.location())); });
	for (const u of ['/', '/signin']) { await page.goto(u); await page.waitForTimeout(1000); }
});
