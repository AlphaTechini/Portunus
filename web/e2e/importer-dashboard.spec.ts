import { expect, test } from '@playwright/test';
import { signInAs } from './helpers';

test('importer dashboard: cash held, cash freed, time to refund and what needs action', async ({
	page
}) => {
	await signInAs(page, 'tunde');
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
	await expect(page.getByText('Cash currently held')).toBeVisible();
	await expect(page.getByText('Cash freed, last 30 days')).toBeVisible();
	await expect(page.getByText('Average time from return to refund')).toBeVisible();
	await expect(page.getByRole('button', { name: /Refund in seconds/ })).toBeVisible();
	await expect(page.getByText(/in free time, \d+ in detention/)).toBeVisible();

	const needs = page.getByTestId('needs-action');
	await expect(needs.getByText(/Pay deposits for/)).toBeVisible();
	await needs.getByRole('link', { name: 'Review' }).first().click();
	await expect(page).toHaveURL(/\/importer\/requests\//);
	await expect(page.getByTestId('pay-deposits')).toBeVisible();
});

test('importer dashboard lists recent refunds with the time from return to refund', async ({
	page
}) => {
	await signInAs(page, 'wanjiru');
	await expect(page.getByText('Recent refunds').first()).toBeVisible();
	await expect(page.getByRole('columnheader', { name: 'Return to refund' })).toBeVisible();
	await expect(
		page.getByRole('table', { name: 'Recent refunds' }).getByRole('row').nth(1)
	).toContainText(/ms|seconds/);
});

test('release requests list filters and opens a request', async ({ page }) => {
	await signInAs(page, 'tunde');
	await page.goto('/importer/requests');
	await page.getByRole('radio', { name: 'Needs action' }).click();
	await expect(page.getByRole('row')).toHaveCount(2);
	await expect(page.getByText('Awaiting deposit').first()).toBeVisible();
});
