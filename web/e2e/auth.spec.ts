import { expect, test } from '@playwright/test';
import { PERSONAS, signInAs, type PersonaKey, currentOrg } from './helpers';

for (const [key, p] of Object.entries(PERSONAS) as [PersonaKey, (typeof PERSONAS)[PersonaKey]][]) {
	test(`demo persona ${key} lands on ${p.home}`, async ({ page }) => {
		await signInAs(page, key);
		await expect(page).toHaveURL(new RegExp(`${p.home}$`));
		await expect(currentOrg(page)).toHaveText(p.org);
		await expect(page.getByTestId('chain-badge')).toContainText('Simulated chain');
	});
}

test('unauthenticated visits are sent to sign in and return to the page afterwards', async ({
	page
}) => {
	await page.goto('/line/returns');
	await expect(page).toHaveURL(/\/signin\?next=%2Fline%2Freturns$/);
	await page.getByTestId('persona-adaeze').click();
	await expect(page).toHaveURL(/\/line\/returns$/);
	await expect(page.getByRole('heading', { name: 'Returns and settlement' })).toBeVisible();
});

test('a next parameter the role may not open falls back to its home', async ({ page }) => {
	await signInAs(page, 'tunde', '/line/settings');
	await expect(page).toHaveURL(/\/importer$/);
});

test('role guard: line users are kept out of /importer and importers out of /line', async ({
	page
}) => {
	await signInAs(page, 'adaeze');
	await page.goto('/importer/requests');
	await expect(page).toHaveURL(/\/line$/);

	await page.getByTestId('user-menu-button').click();
	await page.getByTestId('sign-out').click();
	await expect(page).toHaveURL(/\/signin$/);

	await signInAs(page, 'tunde');
	await page.goto('/line/settings');
	await expect(page).toHaveURL(/\/importer$/);
});

test('every app route renders inside the shell', async ({ page }) => {
	await signInAs(page, 'adaeze');
	for (const [path, title] of [
		['/line/requests/new', 'New release request'],
		['/line/returns', 'Returns and settlement'],
		['/line/held', 'Held transfers'],
		['/line/settings', 'Settings'],
		['/containers', 'Containers'],
		['/disputes', 'Disputes']
	] as const) {
		await page.goto(path);
		await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
	}
	await page.getByTestId('user-menu-button').click();
	await page.getByTestId('sign-out').click();
	await signInAs(page, 'tunde');
	for (const [path, title] of [
		['/importer/requests', 'Release requests'],
		['/importer/requests/abc', 'Release request']
	] as const) {
		await page.goto(path);
		await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
	}
});

test('sign out returns to sign in and drops the session', async ({ page }) => {
	await signInAs(page, 'wanjiru');
	await page.getByTestId('user-menu-button').click();
	await expect(page.getByTestId('user-name')).toHaveText('Wanjiru Mwangi');
	await page.getByTestId('sign-out').click();
	await expect(page).toHaveURL(/\/signin$/);
	await page.goto('/importer');
	await expect(page).toHaveURL(/\/signin\?next=%2Fimporter$/);
});

test('notifications bell lists the organization notifications', async ({ page }) => {
	await signInAs(page, 'tunde');
	await page.getByTestId('notifications-button').click();
	await expect(page.getByRole('dialog', { name: 'Notifications' })).toBeVisible();
});
