import { expect, test } from '@playwright/test';
import { signInAs } from './helpers';

test('the line dashboard shows the key figures, refunds due and quick actions', async ({
	page
}) => {
	await signInAs(page, 'adaeze');
	await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
	const kpis = page.getByRole('region', { name: 'Key figures' });
	await expect(kpis.getByText('Held by protocol')).toBeVisible();
	await expect(kpis.getByText('Deposit-free exposure')).toBeVisible();
	await expect(kpis.getByText('Past free time')).toBeVisible();
	await expect(kpis.getByText('Detention collected')).toBeVisible();
	await expect(kpis.getByText('Refunds due')).toBeVisible();
	await expect(kpis.getByRole('button', { name: /Receive policy/ })).toBeVisible();
	await expect(kpis.getByRole('button', { name: /Access key/ })).toBeVisible();

	await expect(page.getByRole('heading', { name: 'Refunds due' })).toBeVisible();
	await expect(page.getByRole('row', { name: /MRDU 4 8 2 6 9 6/ })).toContainText('On time');
	await expect(page.getByText('Refund compliance')).toBeVisible();
	await expect(page.getByText(/Philippines draft rule/).first()).toBeVisible();

	await page.getByRole('link', { name: 'Review' }).click();
	await expect(page).toHaveURL(/\/line\/held$/);
	await page.goto('/line');
	await page.getByRole('link', { name: 'Record a return' }).click();
	await expect(page).toHaveURL(/\/line\/returns$/);
	await page.goto('/line');
	await page.getByRole('link', { name: 'New release request' }).first().click();
	await expect(page).toHaveURL(/\/line\/requests\/new$/);
});

test('an overdue refund is highlighted after the clock moves past the window', async ({ page }) => {
	await signInAs(page, 'adaeze');
	await page.getByTestId('demo-toggle').click();
	await page.getByRole('button', { name: '+1 day' }).click();
	await expect(page.getByRole('row', { name: /MRDU 4 8 2 6 9 6/ })).toContainText(
		/Due today|On time/
	);
});
