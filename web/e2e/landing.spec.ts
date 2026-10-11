import { expect, test } from '@playwright/test';

test('landing page renders and links to sign in', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	await expect(page).toHaveTitle(/Portunus/);
	await page.getByRole('link', { name: 'Sign in', exact: true }).first().click();
	await expect(page).toHaveURL(/\/signin$/);
	await expect(page.getByRole('heading', { name: 'Sign in to Portunus' })).toBeVisible();
});

test('sign in page shows passkey sign in, account creation and the demo personas', async ({
	page
}) => {
	await page.goto('/signin');
	await expect(page.getByRole('button', { name: /Sign in with passkey/ })).toBeVisible();
	await expect(page.getByRole('button', { name: /Create a passkey/ })).toBeVisible();
	for (const name of [
		'Adaeze Okafor',
		'Tunde Bakare',
		'Wanjiru Mwangi',
		'Carlo Reyes',
		'Joseph Otieno'
	]) {
		await expect(page.getByRole('button', { name: new RegExp(name) })).toBeVisible();
	}
});
