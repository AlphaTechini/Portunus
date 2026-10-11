import { expect, test } from '@playwright/test';
import { signInAs } from './helpers';

test('demo controls move the product clock forward and reset the demo', async ({ page }) => {
	await signInAs(page, 'adaeze');
	await page.getByTestId('demo-toggle').click();
	const panel = page.getByTestId('demo-controls');
	await expect(panel.getByTestId('demo-offset')).toHaveText('In step with real time');

	await panel.getByRole('button', { name: '+1 day' }).click();
	await expect(panel.getByTestId('demo-offset')).toContainText('1d ahead of real time');

	await panel.getByRole('button', { name: '+1 hour' }).click();
	await expect(panel.getByTestId('demo-offset')).toContainText('1d 1h ahead of real time');

	// The clock offset is part of the shared state: it survives a reload.
	await page.reload();
	await expect(page.getByTestId('demo-offset')).toContainText('1d 1h ahead of real time');

	await page.getByRole('button', { name: 'Reset demo data' }).click();
	await page
		.getByRole('dialog', { name: 'Reset demo data?' })
		.getByRole('button', { name: 'Reset demo data' })
		.click();
	await expect(page).toHaveURL(/\/signin$/);

	await signInAs(page, 'adaeze');
	// The panel remembers whether it was open.
	await expect(page.getByTestId('demo-toggle')).toHaveAttribute('aria-expanded', 'true');
	await expect(page.getByTestId('demo-offset')).toHaveText('In step with real time');
});

test("a stranger transfer lands in the line's held transfers badge", async ({ page }) => {
	await signInAs(page, 'adaeze');
	const nav = page.getByRole('navigation', { name: 'Main' }).first();
	const held = nav.getByRole('link', { name: /Held transfers/ });
	const before = Number((await held.locator('.nav-badge').textContent()) ?? '0');
	await page.getByTestId('demo-toggle').click();
	await page.getByRole('button', { name: /Wrong token/ }).click();
	await expect(held.locator('.nav-badge')).toHaveText(String(before + 1));
});

test('demo controls are keyboard accessible and collapse with Escape', async ({ page }) => {
	await signInAs(page, 'tunde');
	const toggle = page.getByTestId('demo-toggle');
	await toggle.focus();
	await page.keyboard.press('Enter');
	await expect(toggle).toHaveAttribute('aria-expanded', 'true');
	await page.keyboard.press('Tab');
	await page.keyboard.press('Escape');
	await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});
