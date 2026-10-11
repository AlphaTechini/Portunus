import { expect, test } from '@playwright/test';
import { signInAs } from './helpers';
import { backend, findContainer, switchTo } from './fe3-helpers';

test('importer disputes posted charges once; the resolver splits the held amount', async ({
	page
}) => {
	// Arrange: the line posts $300 of damage for review on Harbourview's returned container.
	await signInAs(page, 'adaeze');
	const c = await findContainer(page, 'Adaeze Okafor', {
		state: 'returned',
		importer: 'Harbourview Foods Ltd'
	});
	await backend(page, 'Adaeze Okafor', 'action', 'containers.postCharges', {
		containerId: c._id,
		damageUnits: '300000000',
		note: 'Scratch on the door panel',
		settleNow: false
	});

	// Importer sees the charges and disputes part of them.
	await switchTo(page, 'tunde');
	await page.goto(`/containers/${c.number}`);
	const win = page.getByTestId('settlement-window');
	await expect(win.getByText('Posted by the line')).toBeVisible();
	await expect(page.getByTestId('accept-charges')).toBeVisible();
	await page.getByTestId('dispute-open').click();
	const dialog = page.getByRole('dialog', { name: 'Dispute charges' });
	await expect(
		dialog.getByText(/Disputed funds stay held by the settlement contract/)
	).toBeVisible();
	await dialog.getByTestId('submit-dispute').click();
	await expect(dialog.getByText('Tell the resolver why you dispute it.')).toBeVisible();
	await dialog.getByLabel('Amount to dispute').fill('250');
	await dialog.getByLabel('Reason').fill('The scratch was on the pickup report.');
	await dialog.getByTestId('submit-dispute').click();

	const card = page.getByTestId('dispute-card');
	await expect(card.getByText('$250.00')).toBeVisible();
	await expect(
		page.getByText('Disputed funds stay held by the settlement contract.')
	).toBeVisible();
	await expect(page.getByText('Disputed', { exact: true }).first()).toBeVisible();
	// Once only: the dispute action is gone.
	await expect(page.getByTestId('dispute-open')).toHaveCount(0);

	// The resolver decides.
	await switchTo(page, 'resolution');
	await expect(page).toHaveURL(/\/disputes$/);
	await expect(
		page.getByText('Disputed funds stay held by the settlement contract').first()
	).toBeVisible();
	await page
		.getByRole('row', { name: new RegExp(c.number.slice(0, 4)) })
		.filter({ hasText: /\$250\.00/ })
		.getByTestId('open-dispute')
		.click();
	const panel = page.getByTestId('resolve-panel');
	await expect(panel).toBeVisible();
	await page.getByRole('button', { name: 'Split evenly' }).click();
	await expect(page.getByTestId('to-line')).toHaveValue('125.00');
	await page.getByLabel('Note to both sides').fill('Split: the scratch is partly pre-existing.');
	await page.getByTestId('resolve-dispute').click();
	await expect(page.getByTestId('dispute-resolved')).toContainText('$125.00 to the line');
	await expect(
		page
			.getByRole('dialog')
			.getByText(/sim:0x/)
			.first()
	).toBeVisible();

	await page.keyboard.press('Escape');
	await page.getByRole('tab', { name: /Resolved/ }).click();
	await expect(page.getByRole('row', { name: new RegExp(c.number.slice(0, 4)) })).toBeVisible();
});

test('the seeded dispute is visible to the importer and the line, read only', async ({ page }) => {
	await signInAs(page, 'carlo');
	await page.goto('/disputes');
	await expect(page.getByRole('tab', { name: /Open/ })).toBeVisible();
	await page.getByTestId('open-dispute').first().click();
	await expect(page.getByTestId('dispute-drawer')).toBeVisible();
	await expect(page.getByText('Waiting for the resolver')).toBeVisible();
	await expect(page.getByTestId('resolve-dispute')).toHaveCount(0);

	await switchTo(page, 'adaeze');
	await page.goto('/disputes');
	await expect(page.getByText('Pasig Valley Imports').first()).toBeVisible();
});

test('the resolver can open a disputed container, and only those', async ({ page }) => {
	await signInAs(page, 'resolution');
	await page.goto('/containers');
	await page.getByRole('link', { name: /MRDU/ }).first().click();
	await expect(page.getByText('Charges disputed').first()).toBeVisible();
	await expect(page.getByTestId('dispute-card')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Submit return receipt' })).toHaveCount(0);
});
