import { expect, test } from '@playwright/test';
import { signInAs } from './helpers';
import { approveSheet } from './fe3-helpers';

test('Wanjiru authorizes the deposit-free request: no money moves, one access key per container', async ({
	page
}) => {
	await signInAs(page, 'wanjiru');
	await page.goto('/importer/requests');
	await page
		.getByRole('link', { name: /Release request MRDNLOS/ })
		.filter({ hasText: 'MRDNLOS' })
		.first()
		.click();

	await expect(page.getByText('No money moves').first()).toBeVisible();
	const terms = page.getByTestId('key-terms');
	await expect(terms.getByText('$45.00')).toBeVisible();
	await expect(terms.getByText('$75.00')).toBeVisible();
	await expect(terms.getByText('per day, resets daily').first()).toBeVisible();
	await expect(page.getByText('charges address only')).toBeVisible();
	await expect(
		page.getByText(
			/Access key: up to one day's detention per day, payable only to Meridian Ocean Lines, expires \d+ \w+ 2026/
		)
	).toBeVisible();

	await page.getByTestId('authorize-keys').click();
	const sheet = approveSheet(page);
	await sheet.getByRole('button', { name: 'Authorize' }).click();

	const done = page.getByTestId('authorize-success');
	await expect(done.getByText('Authorized 2 access keys')).toBeVisible();
	await expect(done.getByText('Authorized: up to $45.00 per day')).toBeVisible();
	await expect(done.getByText('Authorized: up to $75.00 per day')).toBeVisible();
	await expect(done.getByText(/Final in/).first()).toBeVisible();

	// Active keys can be revoked, with honest copy about what that means.
	await page.getByTestId('revoke-key').first().click();
	const dialog = page.getByRole('dialog', { name: 'Revoke this access key?' });
	await expect(dialog.getByText('no longer guaranteed')).toBeVisible();
	await dialog.getByTestId('confirm-revoke').click();
	await expect(page.getByText('Access key revoked').first()).toBeVisible();
});
