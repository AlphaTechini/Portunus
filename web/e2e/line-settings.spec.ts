import { expect, test } from '@playwright/test';
import { signInAs } from './helpers';

test('the deposits account shows the receive policy and the recovery authority', async ({ page }) => {
	await signInAs(page, 'adaeze');
	await page.goto('/line/settings');
	await expect(page.getByText('Active: deposits held by the guard')).toBeVisible();
	await expect(
		page.getByText('Rejects incoming balance credit. Deposits are held by the protocol guard')
	).toBeVisible();
	await expect(page.getByRole('button', { name: /Receive policy: funds in the protocol guard/ })).toBeVisible();
	await expect(page.getByRole('button', { name: /Settlement contract = recovery authority/ })).toBeVisible();
});

test('the settlement window can be set to the Philippines draft rule and persists', async ({ page }) => {
	await signInAs(page, 'adaeze');
	await page.goto('/line/settings');
	await expect(page.getByTestId('save-rules')).toBeDisabled();
	await page.getByRole('radio', { name: '15 days' }).click();
	await expect(page.getByTestId('window-days')).toHaveValue('15');
	await expect(page.getByText(/matches the Philippines draft rule/)).toBeVisible();
	await page.getByTestId('save-rules').click();
	await expect(page.getByText('Settlement rules saved')).toBeVisible();
	await expect(page.getByTestId('save-rules')).toBeDisabled();

	await page.reload();
	await expect(page.getByTestId('window-days')).toHaveValue('15');
	await expect(page.getByRole('radio', { name: '15 days' })).toBeChecked();
});

test('invalid values are flagged and block saving', async ({ page }) => {
	await signInAs(page, 'adaeze');
	await page.goto('/line/settings');
	await page.getByTestId('window-days').fill('0');
	await expect(page.getByText('Enter a whole number from 1 to 30.')).toBeVisible();
	await expect(page.getByTestId('save-rules')).toBeDisabled();
});

test('rate card rows are edited inline and saved', async ({ page }) => {
	await signInAs(page, 'adaeze');
	await page.goto('/line/settings');
	const row = page.getByTestId('rate-row-20GP');
	await row.getByLabel('Daily detention for 20GP').fill('50.00');
	await expect(page.getByTestId('save-rates')).toBeEnabled();
	await page.getByTestId('save-rates').click();
	await expect(page.getByText('Rate card saved')).toBeVisible();
	await page.reload();
	await expect(page.getByTestId('rate-row-20GP').getByLabel('Daily detention for 20GP')).toHaveValue('50.00');
});

test('the Kestrel line sees its own settings', async ({ page }) => {
	await signInAs(page, 'joseph');
	await page.goto('/line/settings');
	await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
	await expect(page.getByText(/Active: deposits held by the guard|Set up the deposits account/)).toBeVisible();
});
