import { expect, test } from '@playwright/test';
import { signInAs } from './helpers';
import { findContainer, switchTo } from './fe3-helpers';

test('line: the chain refuses a second same-day pull and the memo trail says so', async ({
	page
}) => {
	await signInAs(page, 'adaeze');
	const c = await findContainer(page, 'Adaeze Okafor', {
		state: 'in_detention',
		mode: 'depositFree'
	});
	await page.goto(`/containers/${c.number}`);

	await expect(page.getByText('In detention').first()).toBeVisible();
	await expect(page.getByText('Deposit-free').first()).toBeVisible();
	await expect(page.getByText('Pulled so far')).toBeVisible();
	await expect(page.getByText('Pulled today')).toBeVisible();
	const trail = page.getByTestId('memo-trail');
	await expect(trail.getByText(/Detention pull, day 1/)).toBeVisible();
	await expect(trail.getByText(/Final in \d+ ms/).first()).toBeVisible();
	await expect(trail.getByText(/PC .* D01 /).first()).toBeVisible(); // memo exactly as on-chain

	await page.getByTestId('demo-toggle').click();
	await page.getByRole('button', { name: /Try a second pull today/ }).click();

	const callout = page.getByTestId('refusal-callout');
	await expect(callout.getByText('Refused by the chain: SpendingLimitExceeded')).toBeVisible();
	await expect(
		callout.getByText(/Recurring limit enforced by the protocol, not by our app/)
	).toBeVisible();
	await expect(
		trail.getByText(/SpendingLimitExceeded: second pull on day \d+ refused/)
	).toBeVisible();
	await expect(trail.getByText('Refused by the chain', { exact: true })).toBeVisible();
	await expect(
		trail.getByText('Recurring limit enforced by the protocol, not by our app').first()
	).toBeVisible();
});

test('line: advancing a day and jumping to the end of free time update the container live', async ({
	page
}) => {
	await signInAs(page, 'adaeze');
	const c = await findContainer(page, 'Adaeze Okafor', { state: 'in_free_time', mode: 'held' });
	await page.goto(`/containers/${c.number}`);
	await expect(page.getByText('Free time ends in')).toBeVisible();
	await expect(page.getByText('Accrued detention')).toBeVisible();

	await page.getByTestId('demo-toggle').click();
	await page.getByRole('button', { name: /Jump to end of free time/ }).click();
	await expect(page.getByText('In detention').first()).toBeVisible();
	await expect(page.getByText('In detention for')).toBeVisible();
	await page.getByRole('button', { name: /Advance 1 day/ }).click();
	await expect(page.getByTestId('demo-offset')).toContainText('ahead of real time');
});

test('importer: the same container renders with importer actions and the access key tab', async ({
	page
}) => {
	await signInAs(page, 'wanjiru');
	await page.goto('/containers');
	await page.getByRole('tab', { name: /In detention/ }).click();
	await page.getByRole('link', { name: /MRDU/ }).first().click();
	await expect(page.getByText('In detention').first()).toBeVisible();
	await expect(page.getByRole('button', { name: 'Submit return receipt' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Record return' })).toHaveCount(0);

	await page.getByRole('tab', { name: 'Access key' }).click();
	await expect(page.getByText('Payable only to', { exact: true })).toBeVisible();
	await expect(page.getByText('Remaining today')).toBeVisible();
	await expect(page.getByTestId('revoke-key')).toBeVisible();
	await page.getByRole('tab', { name: 'Details' }).click();
	await expect(page.getByText('Virtual deposit address')).toBeVisible();
	await expect(page.getByRole('button', { name: /Virtual address per container/ })).toBeVisible();
});

test('importer: submitting a return receipt explains the silent-line rule', async ({ page }) => {
	await signInAs(page, 'carlo');
	await page.goto('/containers');
	await page.getByRole('tab', { name: /In detention/ }).click();
	await page.getByRole('link', { name: /MRDU/ }).first().click();
	await page.getByTestId('submit-receipt-open').click();
	const dialog = page.getByRole('dialog', { name: 'Submit return receipt' });
	await expect(page.getByText(/must be at\s+least\s+24\s+hours old/)).toBeVisible();
	await dialog.getByTestId('submit-receipt').click();
	await expect(dialog.getByText('Enter the receipt number from the depot.')).toBeVisible();
});

test('settled container shows the refund and the time from return to refund', async ({ page }) => {
	await signInAs(page, 'tunde');
	await page.goto('/containers');
	await page.getByRole('tab', { name: /Settled/ }).click();
	await page.getByRole('link', { name: /MRDU/ }).first().click();
	const summary = page.getByTestId('settlement-summary');
	await expect(summary.getByText('Refunded to the importer')).toBeVisible();
	await expect(summary.getByTestId('refund-time')).toContainText(/ms|seconds/);
	await expect(summary.getByRole('button', { name: /Refund in seconds/ })).toBeVisible();
});

test('byNumber authorization: another importer gets "not found"', async ({ page }) => {
	await signInAs(page, 'adaeze');
	const c = await findContainer(page, 'Adaeze Okafor', {
		state: 'in_free_time',
		mode: 'held',
		importer: 'Harbourview Foods Ltd'
	});
	await page.goto(`/containers/${c.number}`);
	await expect(page.getByText(/^B\/L MRDNLOS/)).toBeVisible(); // the line sees it

	// Carlo (Pasig Valley) cannot open Harbourview's container.
	await switchTo(page, 'carlo');
	await page.goto(`/containers/${c.number}`);
	await expect(page.getByText('Container not found')).toBeVisible();
	// Neither can Kestrel's line.
	await switchTo(page, 'joseph');
	await page.goto(`/containers/${c.number}`);
	await expect(page.getByText('Container not found')).toBeVisible();
});
