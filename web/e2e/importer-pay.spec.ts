import { expect, test } from '@playwright/test';
import { signInAs } from './helpers';
import { approveSheet } from './fe3-helpers';

test('Tunde pays the seeded three-container request and every deposit is held by the protocol', async ({
	page
}) => {
	await signInAs(page, 'tunde');
	await page.goto('/importer/requests');
	await page
		.getByRole('link', { name: /Release request MRDNLOS/ })
		.first()
		.click();

	// Terms are shown before paying: one row per container and the refund rule in plain words.
	await expect(page.getByRole('heading', { name: 'Terms' })).toBeVisible();
	await expect(page.getByRole('row')).toHaveCount(4); // header + 3 containers
	await expect(page.getByText('remainder refunds to you automatically')).toBeVisible();
	await expect(page.getByText('dispute posted charges once')).toBeVisible();

	// Tempo features named where they work.
	await expect(page.getByRole('button', { name: /Batch transaction/ })).toBeVisible();
	await expect(page.getByRole('button', { name: /Fee sponsored, no gas/ })).toBeVisible();
	await expect(
		page.getByRole('button', { name: /Memo: container and B\/L number/ }).first()
	).toBeVisible();
	await expect(page.getByRole('button', { name: /Virtual address per container/ })).toBeVisible();
	await expect(page.getByText('Your balance')).toBeVisible();
	await expect(page.getByText('After payment', { exact: true })).toBeVisible();
	await expect(page.getByText('PD MRDU', { exact: false }).first()).toBeVisible(); // memo text per container

	await page.getByTestId('pay-deposits').click();
	const sheet = approveSheet(page);
	await expect(sheet.getByText('$5,200.00')).toBeVisible();
	await sheet.getByRole('button', { name: /Pay 3 deposits/ }).click();

	const done = page.getByTestId('pay-success');
	await expect(done.getByRole('heading', { name: 'Deposit held by protocol' })).toBeVisible();
	await expect(done.getByText(/Final in/)).toBeVisible();
	await expect(done.getByText('Deposit held by protocol', { exact: true }).first()).toBeVisible();
	await expect(done.getByText(/Receive policy: funds in the protocol guard/)).toBeVisible();
	await expect(done.getByText(/TIP.1028/).first()).toBeVisible();

	// Paid: the pay panel is gone and a reload says it is already paid.
	await expect(page.getByTestId('pay-deposits')).toHaveCount(0);
	await page.reload();
	await expect(page.getByTestId('already-paid')).toBeVisible();
});

test('the line sees the deposit held after the importer pays', async ({ page }) => {
	await signInAs(page, 'tunde');
	await page.goto('/importer/requests');
	await page
		.getByRole('link', { name: /Release request MRDNLOS/ })
		.first()
		.click();
	await page.getByTestId('pay-deposits').click();
	await approveSheet(page)
		.getByRole('button', { name: /Pay 3 deposits/ })
		.click();
	await expect(page.getByTestId('pay-success')).toBeVisible();

	await page.goto('/containers');
	await page.getByRole('tab', { name: /Awaiting/ }).click();
	await expect(page.getByText('Deposit held').first()).toBeVisible();
});

test('an importer cannot open another importer request', async ({ page }) => {
	await signInAs(page, 'carlo');
	await page.goto('/importer/requests/ZZZZZZ');
	await expect(page.getByText('Request not found')).toBeVisible();
});
