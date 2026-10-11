import { expect, test } from '@playwright/test';
import { addVirtualAuthenticator, signInAs } from './helpers';

test('demo personas approve with a simulated passkey sheet', async ({ page }) => {
	await signInAs(page, 'tunde');
	await page.goto('/dev/approval');
	await page.getByTestId('ask-approval').click();
	const sheet = page.getByRole('dialog', { name: 'Approve payment' });
	await expect(sheet.getByText('Simulated approval (demo persona)')).toBeVisible();
	await expect(sheet.getByText('$3,450.00')).toBeVisible();
	await sheet.getByRole('button', { name: /Pay 3 deposits/ }).click();
	await expect(page.getByTestId('approval-result')).toContainText('"method": "demo"');
	await expect(page.getByTestId('approval-result')).toContainText('"approvedWith": "demo"');
});

test('cancelling the approval sheet is not an error', async ({ page }) => {
	await signInAs(page, 'tunde');
	await page.goto('/dev/approval');
	await page.getByTestId('ask-approval').click();
	await page
		.getByRole('dialog', { name: 'Approve payment' })
		.getByRole('button', { name: 'Cancel' })
		.click();
	await expect(page.getByTestId('approval-note')).toHaveText('Cancelled.');
});

test('users with a passkey approve with a real WebAuthn assertion', async ({ page, context }) => {
	await addVirtualAuthenticator(context, page);
	await page.goto('/signin');
	await page.getByRole('button', { name: /Create a passkey/ }).click();
	await page.getByLabel('Your name').fill('Amara Okeke');
	await page.getByRole('textbox', { name: /^Organization/ }).fill('Harbourline Clearing');
	await page.getByRole('button', { name: /Create account with passkey/ }).click();
	await expect(page).toHaveURL(/\/importer$/);

	await page.goto('/dev/approval');
	await page.getByTestId('ask-approval').click();
	const sheet = page.getByRole('dialog', { name: 'Approve payment' });
	await expect(sheet.getByText('Simulated approval')).toHaveCount(0);
	await sheet.getByRole('button', { name: /Pay 3 deposits/ }).click();
	const out = page.getByTestId('approval-result');
	await expect(out).toContainText('"method": "passkey"');
	await expect(out).toContainText('"signatureR"');
	await expect(out).toContainText('"clientDataJSON"');
});

/** ISO 6346 check digit, so the test can mint valid container numbers. */
function containerNumber(owner: string, serial: string): string {
	const base = `${owner}${serial}`;
	const values: Record<string, number> = {};
	let v = 10;
	for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
		if (v % 11 === 0) v++;
		values[ch] = v++;
	}
	let sum = 0;
	[...base].forEach((c, i) => {
		const n = /\d/.test(c) ? Number(c) : values[c];
		sum += n * 2 ** i;
	});
	return `${base}${(sum % 11) % 10}`;
}

test('the passkey approval is accepted by the backend (deposits.payBatch)', async ({
	page,
	context
}) => {
	await addVirtualAuthenticator(context, page);
	await page.goto('/signin');
	await page.getByRole('button', { name: /Create a passkey/ }).click();
	await page.getByLabel('Your name').fill('Amara Okeke');
	await page.getByRole('textbox', { name: /^Organization/ }).fill('Harbourline Clearing');
	await page.getByRole('button', { name: /Create account with passkey/ }).click();
	await expect(page).toHaveURL(/\/importer$/);

	// Meridian sends this new importer a release request.
	const number = containerNumber('MRDU', '735104');
	const setup = await page.evaluate(async (containerNo) => {
		const { getBackend, session } = await import('/src/lib/backend/index.ts');
		const { api } = await import('/src/lib/app/api.ts');
		const b = getBackend();
		const importerToken = session.token!;
		const me = await b.query(api.auth.me, { sessionToken: importerToken });
		const personas = await b.query(api.auth.listDemoPersonas, {});
		const adaeze = personas.find((p) => p.name === 'Adaeze Okafor')!;
		const { sessionToken: lineToken } = await b.mutation(api.auth.signInAsDemo, {
			userId: adaeze.userId
		});
		const req = await b.mutation(api.releaseRequests.create, {
			sessionToken: lineToken,
			importerOrgId: me!.org._id,
			billOfLading: 'MRDNLOS2610001',
			portOfDischarge: 'Apapa',
			mode: 'held',
			containers: [{ number: containerNo, type: '20GP' }]
		});
		const preview = await b.query(api.deposits.preview, {
			sessionToken: importerToken,
			requestId: req.requestId
		});
		return { requestId: req.requestId as string, payloadHash: preview.payloadHash as string };
	}, number);

	await page.goto(`/dev/approval?hash=${setup.payloadHash}`);
	await page.getByTestId('ask-approval').click();
	await page
		.getByRole('dialog', { name: 'Approve payment' })
		.getByRole('button', { name: /Pay 3 deposits/ })
		.click();
	const approval = JSON.parse(
		(await page.getByTestId('approval-result').textContent()) ?? '{}'
	).approval;
	expect(approval.method).toBe('passkey');

	const paid = await page.evaluate(
		async ({ requestId, approval }) => {
			const { getBackend, session } = await import('/src/lib/backend/index.ts');
			const { api } = await import('/src/lib/app/api.ts');
			return getBackend().action(api.deposits.payBatch, {
				sessionToken: session.token!,
				requestId: requestId as never,
				approval
			});
		},
		{ requestId: setup.requestId, approval }
	);
	expect(paid.allCovered).toBe(true);
	expect(paid.txHash).toMatch(/^0x[0-9a-f]{64}$/);
});
