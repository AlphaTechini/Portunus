import { expect, test } from '@playwright/test';
import { signInAs } from './helpers';
import { backendAs } from './line-helpers';

test('record a return, post charges and see the settled amounts', async ({ page }) => {
	await signInAs(page, 'adaeze');
	await page.goto('/line/returns');
	await expect(page.getByRole('tab', { name: /Awaiting return/ })).toBeVisible();

	// MRDU 482591-8: held deposit of $1,200.00, still in free time.
	await page.getByTestId('record-return-MRDU4825918').click();
	const drawer = page.getByRole('dialog', { name: /Record return of MRDU 482591-8/ });
	await drawer.getByRole('textbox', { name: /EIR/ }).fill('EIR-MRDN-900001');
	await drawer.getByLabel('Depot').fill('Apapa Empty Depot');
	await expect(drawer.getByText('If you post no damage')).toBeVisible();
	await drawer.getByRole('button', { name: 'Record return' }).click();

	// The settle panel opens straight away, inside the window.
	const settle = page.getByTestId('settle-drawer');
	await expect(settle.getByTestId('settle-eir')).toHaveText('EIR-MRDN-900001');
	await expect(settle.getByText('Settlement window ends in')).toBeVisible();
	await expect(settle.getByRole('button', { name: /Settlement contract = recovery authority/ })).toBeVisible();
	await settle.getByTestId('damage-input').fill('150');
	await expect(settle.getByTestId('to-line')).toHaveText('$150.00');
	await expect(settle.getByTestId('refund-amount')).toHaveText('$1,050.00');

	await page.getByTestId('post-charges').click();
	const result = page.getByTestId('settle-result');
	await expect(result).toContainText('Settled: $150.00 to Meridian Ocean Lines, $1,050.00 refunded');
	await expect(result.getByText(/sim:0x/)).toBeVisible();
	await expect(result.getByRole('button', { name: /Refund in seconds/ })).toBeVisible();
	await page.getByRole('dialog').getByRole('button', { name: 'Close' }).last().click();

	await page.getByRole('tab', { name: /Settled/ }).click();
	await expect(page.getByRole('row', { name: /MRDU 4 8 2 5 9 1/ })).toContainText('$1,050.00');
});

test('damage is capped by the deposit', async ({ page }) => {
	await signInAs(page, 'adaeze');
	await page.goto('/line/returns');
	await page.getByRole('tab', { name: /In settlement window/ }).click();
	// MRDU 482696-1 is already returned, deposit $2,200.00.
	await page.getByTestId('review-MRDU4826961').click();
	const settle = page.getByTestId('settle-drawer');
	await settle.getByTestId('damage-input').fill('9000');
	await expect(settle.getByTestId('to-line')).toHaveText('$2,200.00');
	await expect(settle.getByTestId('refund-amount')).toHaveText('$0.00');
});

test('settle several returned containers in one batch transaction', async ({ page }) => {
	await signInAs(page, 'adaeze');
	await page.goto('/line/returns');
	// Return a second container so two wait for settlement.
	await page.getByTestId('record-return-MRDU4825625').click();
	const drawer = page.getByRole('dialog', { name: /Record return of/ });
	await drawer.getByRole('textbox', { name: /EIR/ }).fill('EIR-MRDN-900002');
	await drawer.getByLabel('Depot').fill('Tin Can Empty Depot');
	await drawer.getByRole('button', { name: 'Record return' }).click();
	await page.getByRole('dialog', { name: /^Settle/ }).getByRole('button', { name: 'Cancel' }).click();

	await page.getByText('Select all', { exact: true }).click();
	const batch = page.getByTestId('settle-selected');
	await expect(batch).toContainText('Settle 2 selected in one transaction');
	await expect(page.getByRole('button', { name: /Batch transaction/ }).first()).toBeVisible();
	await batch.click();
	await expect(page.getByTestId('batch-summary')).toHaveText(/2 containers settled/);
	await expect(page.getByText(/sim:0x/).first()).toBeVisible();
});

test('a return receipt submitted by the importer can be contested', async ({ page }) => {
	await signInAs(page, 'adaeze');
	await page.goto('/line/returns');
	// MRDU 482653-4 is a held container in detention. Carlo files the receipt himself (silent line rule).
	const list = await backendAs<{ _id: string; number: string }[]>(
		page,
		'Adaeze Okafor',
		'query',
		'containers.listForLine',
		{}
	);
	const c = list.find((x) => x.number === 'MRDU4826534')!;
	await backendAs(page, 'Carlo Reyes', 'mutation', 'containers.submitReturnReceipt', {
		containerId: c._id,
		eirNumber: 'EIR-PASIG-0001',
		depot: 'Apapa Empty Depot',
		date: Date.now() - 2 * 86_400_000
	});

	await page.getByRole('tab', { name: /In settlement window/ }).click();
	await expect(page.getByText(/submitted\s+by\s+the\s+importer/).first()).toBeVisible();
	await page.getByTestId('contest-MRDU4826534').click();
	await page.getByTestId('confirm-contest').click();
	await page.getByRole('tab', { name: /Awaiting return/ }).click();
	await expect(page.getByRole('row', { name: /MRDU 4 8 2 6 5 3/ })).toContainText('In detention');
});

test('a deposit-free container settles without a refund and the key is revoked', async ({ page }) => {
	await signInAs(page, 'adaeze');
	await page.goto('/line/returns');
	// MRDU 482662-1: deposit-free, in detention.
	await page.getByTestId('record-return-MRDU4826621').click();
	const drawer = page.getByRole('dialog', { name: /Record return of/ });
	await drawer.getByRole('textbox', { name: /EIR/ }).fill('EIR-MRDN-900003');
	await drawer.getByLabel('Depot').fill('Apapa Empty Depot');
	await drawer.getByRole('button', { name: 'Record return' }).click();
	const settle = page.getByTestId('settle-drawer');
	await expect(settle.getByText(/never left their account/)).toBeVisible();
	await page.getByTestId('post-charges').click();
	const result = page.getByTestId('settle-result');
	await expect(result).toBeVisible();
	await expect(result.getByRole('button', { name: /Access key revoked/ })).toBeVisible();
});
