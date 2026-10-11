import { expect, test } from '@playwright/test';
import { signInAs } from './helpers';
import { backendAs, createRequest, mrdu } from './line-helpers';

test('a held request with three containers shows three virtual addresses', async ({ page }) => {
	await signInAs(page, 'adaeze');
	await createRequest(page, {
		importer: 'Harbourview',
		billOfLading: 'MRDNLOS26900',
		numbers: [mrdu(910001), mrdu(910002), mrdu(910003)]
	});

	await expect(
		page.getByRole('heading', { name: /Request sent to Harbourview Foods Ltd/ })
	).toBeVisible();
	const addresses = page.getByTestId('deposit-address');
	await expect(addresses).toHaveCount(3);
	for (const a of await addresses.all()) await expect(a).toContainText(/0x[0-9a-f]{8}/);
	await expect(page.getByRole('button', { name: /Virtual address per container/ })).toBeVisible();
	await expect(page.getByText('Waiting for payment')).toBeVisible();
	await expect(page.getByTestId('importer-link')).toContainText('/importer/requests/');
	// Nothing is covered yet, so the release order is blocked and says why.
	await expect(page.getByTestId('issue-release')).toBeDisabled();
	await expect(page.getByText(/No deposit received yet: \$2,200\.00 due/).first()).toBeVisible();
});

test('the request page flips live when the importer pays, then the release order is issued', async ({
	page
}) => {
	await signInAs(page, 'adaeze');
	const id = await createRequest(page, {
		importer: 'Harbourview',
		billOfLading: 'MRDNLOS26901',
		numbers: [mrdu(910011), mrdu(910012), mrdu(910013)]
	});
	await expect(page.getByText('Waiting for payment')).toBeVisible();

	// Tunde pays all three deposits in one batch transaction, from his side.
	await backendAs(page, 'Tunde Bakare', 'action', 'deposits.payBatch', {
		requestId: id,
		approval: { method: 'demo' }
	});

	await expect(page.getByText('Deposit held by protocol').first()).toBeVisible();
	await expect(
		page.getByRole('button', {
			name: /Receive policy: funds in the protocol guard, not the line's balance/
		})
	).toBeVisible();
	await expect(page.getByTestId('issue-release')).toBeEnabled();
	await expect(page.getByText(/3 of 3/)).toBeVisible();

	await page.getByTestId('issue-release').click();
	await expect(page.getByText(/Issued for all 3/)).toBeVisible();
	await expect(page.getByText('In free time').first()).toBeVisible();
});

test('the seeded request awaiting payment keeps the release order blocked and says what is missing', async ({
	page
}) => {
	await signInAs(page, 'adaeze');
	// The seeded request waiting for Tunde has three containers; cover none, then see the reasons.
	await page.goto('/line/requests');
	await page.getByRole('link', { name: /Open request MRDNLOS26374/ }).click();
	await expect(page.getByTestId('issue-release')).toBeDisabled();
	await expect(page.getByText(/Deposit incomplete|No deposit received yet/).first()).toBeVisible();
});

test('container numbers are checked live and a wrong check digit can be fixed in one click', async ({
	page
}) => {
	await signInAs(page, 'adaeze');
	await page.goto('/line/requests/new');
	const good = mrdu(910021);
	const row = page.getByLabel('Container number, row 1');
	await row.fill(good.slice(0, 10) + String((Number(good[10]) + 1) % 10));
	await expect(page.getByText(/Check digit should be/)).toBeVisible();
	await page.getByRole('button', { name: /^Use \d$/ }).click();
	await expect(row).toHaveValue(good);
	await expect(page.getByText('Check digit matches')).toBeVisible();

	// Pasting several numbers into one box splits them into rows.
	await row.fill('');
	await row.evaluate(
		(el, text) => {
			const dt = new DataTransfer();
			dt.setData('text', text);
			el.dispatchEvent(
				new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
			);
		},
		`${mrdu(910022)} ${mrdu(910023)}, ${mrdu(910024)}`
	);
	await expect(page.getByLabel('Container number, row 2')).toHaveValue(mrdu(910023));
	await expect(page.getByLabel('Container number, row 3')).toHaveValue(mrdu(910024));
});

test('deposit-free is offered only to an importer with enough clean returns', async ({ page }) => {
	await signInAs(page, 'adaeze');
	await page.goto('/line/requests/new');
	const select = page.getByRole('combobox', { name: /Importer/ }).first();
	const pick = async (name: string) => {
		const v = await select.locator('option', { hasText: name }).getAttribute('value');
		await select.selectOption(v!);
	};
	await pick('Harbourview');
	await expect(page.getByRole('radio', { name: /Deposit-free/ })).toBeDisabled();
	await expect(page.getByRole('radio', { name: /Held deposit/ })).toBeChecked();
	await pick('Savanna');
	await expect(page.getByTestId('track-record')).toContainText(
		'6 clean returns: eligible for deposit-free'
	);
	await expect(page.getByRole('radio', { name: /Deposit-free/ })).toBeChecked();
	await expect(page.getByRole('button', { name: /Access key/ }).first()).toBeVisible();
});

test('the request list links to each request', async ({ page }) => {
	await signInAs(page, 'adaeze');
	await page.goto('/line/requests');
	await expect(page.getByRole('heading', { level: 1, name: 'Release requests' })).toBeVisible();
	await expect(page.getByRole('row')).not.toHaveCount(1);
	await page
		.getByRole('link', { name: /Open request/ })
		.first()
		.click();
	await expect(page).toHaveURL(/\/line\/requests\/[^/?]+$/);
});
