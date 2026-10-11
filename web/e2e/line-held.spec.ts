import { expect, test } from '@playwright/test';
import { signInAs } from './helpers';

test('held transfers show why they are held and can be returned to the sender', async ({ page }) => {
	await signInAs(page, 'adaeze');
	await page.goto('/line/held');
	await expect(page.getByRole('button', { name: /Held, not lost/ })).toBeVisible();
	await expect(page.getByRole('table').getByText('Wrong token')).toBeVisible();
	await expect(page.getByRole('table').getByText('Unknown sender')).toBeVisible();
	await expect(page.getByRole('tab', { name: /Held/ })).toContainText('2');

	await page.getByTestId('return-to-sender').first().click();
	const result = page.getByTestId('return-result');
	await expect(result).toContainText('Returned');
	await expect(result.getByText(/sim:0x/)).toBeVisible();
	await expect(page.getByRole('tab', { name: /Held/ })).toContainText('1');

	await page.getByRole('tab', { name: /Returned/ }).click();
	await expect(page.getByRole('row')).toHaveCount(2); // header + the returned transfer
});

test('a stranger transfer from the demo panel lands in the held list', async ({ page }) => {
	await signInAs(page, 'adaeze');
	await page.goto('/line/held');
	await page.getByTestId('demo-toggle').click();
	await page.getByRole('button', { name: /Simulate a stranger transfer \(BetaUSD\)/ }).click();
	await expect(page.getByRole('tab', { name: /Held/ })).toContainText('3');
	await page.getByRole('button', { name: /Simulate a stranger transfer \(unknown sender\)/ }).click();
	await expect(page.getByRole('tab', { name: /Held/ })).toContainText('4');
});

test('the empty state shows once everything is returned', async ({ page }) => {
	await signInAs(page, 'joseph');
	await page.goto('/line/held');
	await expect(page.getByText('No held transfers')).toBeVisible();
});
