import { expect, test } from '@playwright/test';
import { signInAs, currentOrg } from './helpers';

test('the demo role switch signs in as the matching persona on the other side', async ({
	page
}) => {
	await signInAs(page, 'adaeze');
	const header = page.getByRole('banner');
	await expect(currentOrg(page)).toHaveText('Meridian Ocean Lines');

	await header.getByRole('radio', { name: 'Importer' }).click();
	await expect(page).toHaveURL(/\/importer$/);
	await expect(currentOrg(page)).toHaveText('Harbourview Foods Ltd');
	await expect(
		page.getByRole('navigation', { name: 'Main' }).first().getByText('Release requests')
	).toBeVisible();

	await header.getByRole('radio', { name: 'Line' }).click();
	await expect(page).toHaveURL(/\/line$/);
	await expect(currentOrg(page)).toHaveText('Meridian Ocean Lines');
});

test('the switch remembers the importer persona that was last used', async ({ page }) => {
	await signInAs(page, 'wanjiru');
	const header = page.getByRole('banner');
	await header.getByRole('radio', { name: 'Line' }).click();
	await expect(page).toHaveURL(/\/line$/);
	await header.getByRole('radio', { name: 'Importer' }).click();
	await expect(currentOrg(page)).toHaveText('Savanna Agro Traders');
});

test('the organization menu switches between demo personas', async ({ page }) => {
	await signInAs(page, 'adaeze');
	await page
		.getByRole('banner')
		.getByRole('button', { name: /Meridian Ocean Lines/ })
		.click();
	await page.getByRole('menuitem', { name: /Kestrel Container Line/ }).click();
	await expect(currentOrg(page)).toHaveText('Kestrel Container Line');
});
