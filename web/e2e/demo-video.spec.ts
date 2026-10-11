import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signInAs } from './helpers';
import { approveSheet, switchTo } from './fe3-helpers';
import { mrdu } from './line-helpers';

/**
 * demo-video.md, Chapter 3 (and the Chapter 4 close) played end to end on fresh data. One serial
 * test per step, one shared browser page, switching persona between steps. Every on-screen label
 * the script names is asserted on the page where the script says the viewer sees it.
 *
 * Each step also saves a 1440 px light-theme frame to docs/screens/demo/. These double as the
 * storyboard frames for the video, so the captured state is the one the narration describes.
 */
const OUT = join(dirname(fileURLToPath(import.meta.url)), '../../docs/screens/demo');
mkdirSync(OUT, { recursive: true });

let context: BrowserContext;
let page: Page;

/** A storyboard frame. Waits a beat so entrance animations and toasts have settled. */
async function frame(name: string) {
	await page.waitForTimeout(450);
	await page.screenshot({ path: join(OUT, `${name}.png`) });
}

/** Open or close the floating demo panel (it remembers its state across reloads and resets). */
async function demoPanel(open: boolean) {
	const toggle = page.getByTestId('demo-toggle');
	if ((await toggle.getAttribute('aria-expanded')) !== String(open)) await toggle.click();
	await expect(toggle).toHaveAttribute('aria-expanded', String(open));
}

/** Text of the first visible Tempo label button (they carry the label and TIP in their name). */
const tempoLabel = (re: RegExp) => page.getByRole('button', { name: re }).first();

// Created in step 1 and carried through the later steps.
const held = { bl: 'MRDNLOS27001', numbers: [mrdu(920001), mrdu(920002), mrdu(920003)] };
const free = { bl: 'MRDNLOS27002', number: mrdu(920011) };
const problems: string[] = [];
let heldRequestId = '';
let heldImporterPath = '';
let freeImporterPath = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
	context = await browser.newContext({
		colorScheme: 'light',
		viewport: { width: 1440, height: 810 }
	});
	page = await context.newPage();
	page.on('pageerror', (e) => problems.push(`uncaught: ${e.message}`));
	page.on('console', (m) => {
		if (m.type() === 'error') problems.push(`console error: ${m.text()}`);
	});
});

test.afterAll(async () => {
	await context.close();
});

test.afterEach(async ({}, testInfo) => {
	if (testInfo.status !== testInfo.expectedStatus) {
		await page.screenshot({ path: testInfo.outputPath('failure.png') }).catch(() => {});
	}
	// No step may leave an uncaught exception or a console error behind.
	expect(problems.splice(0)).toEqual([]);
});

test('00 fresh data: reset the local database', async () => {
	await signInAs(page, 'adaeze');
	await demoPanel(true);
	await page.getByRole('button', { name: 'Reset demo data' }).click();
	await page
		.getByRole('dialog', { name: 'Reset demo data?' })
		.getByRole('button', { name: 'Reset demo data' })
		.click();
	await expect(page).toHaveURL(/\/signin$/);
	// Fresh seed: the held transfers and the seeded requests are exactly the shipped ones.
	await signInAs(page, 'adaeze');
	await demoPanel(false);
	await page.goto('/line/held');
	await expect(page.getByRole('tab', { name: /Held/ })).toContainText('2');
});

test('1 line: a held release request for Harbourview with 3 containers and 3 virtual addresses', async () => {
	await page.goto('/line/requests/new');
	const select = page.getByRole('combobox', { name: /Importer/ }).first();
	const option = select.locator('option', { hasText: 'Harbourview' });
	await expect(option).toHaveCount(1);
	await select.selectOption((await option.getAttribute('value'))!);
	// "picks Held deposit for this importer": a new importer is not offered deposit-free.
	await expect(page.getByRole('radio', { name: /Held deposit/ })).toBeChecked();
	await expect(page.getByRole('radio', { name: /Deposit-free/ })).toBeDisabled();
	await page.getByRole('textbox', { name: 'Bill of lading' }).fill(held.bl);
	for (const [i, n] of held.numbers.entries()) {
		if (i > 0) await page.getByRole('button', { name: 'Add container' }).click();
		await page.getByLabel(`Container number, row ${i + 1}`).fill(n);
	}
	await expect(tempoLabel(/Virtual address per container/)).toBeVisible();
	await frame('01-line-new-release-request');

	await page.getByRole('button', { name: 'Create request and generate addresses' }).click();
	await expect(page).toHaveURL(/\/line\/requests\/[^/]+\?new=1/);
	heldRequestId = page.url().split('/line/requests/')[1].split('?')[0];

	await expect(
		page.getByRole('heading', { name: /Request sent to Harbourview Foods Ltd/ })
	).toBeVisible();
	const addresses = page.getByTestId('deposit-address');
	await expect(addresses).toHaveCount(3);
	for (const a of await addresses.all()) await expect(a).toContainText(/0x[0-9a-f]{8}/);
	// "Virtual address per container (TIP-1022)"
	await expect(tempoLabel(/Virtual address per container, TIP-1022/)).toBeVisible();
	await expect(page.locator('.tipref', { hasText: 'TIP-1022' }).first()).toBeVisible();
	await expect(page.getByText('Waiting for payment')).toBeVisible();
	heldImporterPath = new URL(
		(await page.getByTestId('importer-link').innerText()).trim(),
		'http://localhost'
	).pathname;
	await frame('02-line-request-three-virtual-addresses');
});

test('2 importer: pays all 3 deposits in one tap; the line flips to Deposit held by protocol', async () => {
	await switchTo(page, 'tunde', heldImporterPath);
	await expect(page.getByRole('heading', { name: 'Terms' })).toBeVisible();
	await expect(page.getByRole('row')).toHaveCount(4); // header + 3 containers
	await expect(tempoLabel(/Batch transaction/)).toBeVisible();
	await expect(tempoLabel(/Fee sponsored, no gas/)).toBeVisible();
	await expect(tempoLabel(/Memo: container and B\/L number/)).toBeVisible();
	await expect(page.getByText(new RegExp(`PD MRDU\\d{7} ${held.bl}`)).first()).toBeVisible();
	await frame('03-importer-terms-and-batch-payment');

	await page.getByTestId('pay-deposits').click();
	const sheet = approveSheet(page);
	await expect(sheet).toBeVisible();
	// Signed in with a passkey: the approval sheet is the passkey prompt (demo persona: simulated).
	await expect(sheet.getByText(/Passkey|passkey|Face ID/).first()).toBeVisible();
	await expect(sheet.getByText(/\$[\d,]+\.\d{2}/).first()).toBeVisible();
	await frame('04-importer-passkey-approval');
	await sheet.getByRole('button', { name: /Pay 3 deposits/ }).click();

	const done = page.getByTestId('pay-success');
	await expect(done.getByRole('heading', { name: 'Deposit held by protocol' })).toBeVisible();
	await expect(done.getByText(/Final in \d+ ms/)).toBeVisible();
	await expect(done.getByText(/Receive policy: funds in the protocol guard/)).toBeVisible();
	await expect(done.getByText(/TIP.1028/).first()).toBeVisible();
	await frame('05-importer-deposits-held-by-protocol');

	// The line's screen: Deposit held by protocol, with the TIP-1028 label, and the release order.
	await switchTo(page, 'adaeze', `/line/requests/${heldRequestId}`);
	await expect(page.getByText('Deposit held by protocol').first()).toBeVisible();
	await expect(
		tempoLabel(/Receive policy: funds in the protocol guard, not the line's balance, TIP-1028/)
	).toBeVisible();
	await expect(page.getByText(/3 of 3/)).toBeVisible();
	await frame('06-line-deposit-held-by-protocol');
	await expect(page.getByTestId('issue-release')).toBeEnabled();
	await page.getByTestId('issue-release').click();
	await expect(page.getByText(/Issued for all 3/)).toBeVisible();
	await expect(page.getByText('In free time').first()).toBeVisible();
	await frame('07-line-release-order-issued');
});

test('3 importer: deposit-free authorization for Savanna with the access key label and expiry', async () => {
	// The line picks deposit-free for Savanna (six clean returns) and sends one container.
	await page.goto('/line/requests/new');
	const select = page.getByRole('combobox', { name: /Importer/ }).first();
	const option = select.locator('option', { hasText: 'Savanna' });
	await expect(option).toHaveCount(1);
	await select.selectOption((await option.getAttribute('value'))!);
	await expect(page.getByTestId('track-record')).toContainText('eligible for deposit-free');
	await expect(page.getByRole('radio', { name: /Deposit-free/ })).toBeChecked();
	await page.getByRole('textbox', { name: 'Bill of lading' }).fill(free.bl);
	await page.getByLabel('Container number, row 1').fill(free.number);
	await page.getByRole('button', { name: 'Create request and generate addresses' }).click();
	await expect(page).toHaveURL(/\/line\/requests\/[^/]+\?new=1/);
	freeImporterPath = new URL(
		(await page.getByTestId('importer-link').innerText()).trim(),
		'http://localhost'
	).pathname;

	await switchTo(page, 'wanjiru', freeImporterPath);
	await expect(page.getByText('No money moves').first()).toBeVisible();
	await expect(
		page
			.getByTestId('key-terms')
			.getByText(/\$\d+\.\d{2}/)
			.first()
	).toBeVisible();
	await expect(
		page.getByTestId('key-terms').getByText('per day, resets daily').first()
	).toBeVisible();
	const keyLabel =
		/Access key: up to one day's detention per day, payable only to Meridian Ocean Lines, expires \d{1,2} \w{3} \d{4}/;
	await expect(page.getByText(keyLabel).first()).toBeVisible();
	await frame('08-importer-deposit-free-authorize');

	await page.getByTestId('authorize-keys').click();
	await approveSheet(page).getByRole('button', { name: 'Authorize' }).click();
	const done = page.getByTestId('authorize-success');
	await expect(
		done.getByRole('heading', { name: /Authorized: up to \$\d+\.\d{2} per day/ })
	).toBeVisible();
	await expect(done.getByText('No money moved')).toBeVisible();
	await expect(done.getByText(/Final in \d+ ms/).first()).toBeVisible();
	await expect(
		page
			.locator('.live-sub')
			.getByText(/payable only to Meridian Ocean Lines,\s+expires\s+\d{1,2} \w{3} \d{4}/)
	).toBeVisible();
	await frame('09-importer-access-key-authorized');

	// No money moved, and the line releases the container on the spot.
	await switchTo(page, 'adaeze', '/line/requests');
	await page.getByRole('link', { name: new RegExp(`Open request ${free.bl}`) }).click();
	await page.getByTestId('issue-release').click();
	await expect(page.getByText('Issued for the container.')).toBeVisible();
	await frame('10-line-deposit-free-released');
});

test('4 container detail: free time ends, a detention pull appears, a second same-day pull is refused', async () => {
	await page.goto(`/containers/${free.number}`);
	await expect(page.getByText('In free time').first()).toBeVisible();
	await expect(page.getByText('Deposit-free').first()).toBeVisible();
	await frame('11-container-free-time-countdown');

	await demoPanel(true);
	await page.getByRole('button', { name: /Jump to end of free time/ }).click();
	await expect(page.getByText('In detention').first()).toBeVisible();
	const trail = page.getByTestId('memo-trail');
	await expect(trail.getByText(/Detention pull, day 1/)).toBeVisible();
	await expect(trail.getByText(/Final in \d+ ms/).first()).toBeVisible();
	await expect(page.getByText('Pulled so far')).toBeVisible();
	await demoPanel(false);
	await frame('12-container-detention-pull');

	await demoPanel(true);
	await page.getByRole('button', { name: /Try a second pull today/ }).click();
	const callout = page.getByTestId('refusal-callout');
	await expect(callout.getByText('Refused by the chain: SpendingLimitExceeded')).toBeVisible();
	await expect(
		callout.getByText('Recurring limit enforced by the protocol, not by our app')
	).toBeVisible();
	await expect(
		trail.getByText(/SpendingLimitExceeded: second pull on day \d+ refused/)
	).toBeVisible();
	await demoPanel(false);
	await frame('13-container-second-pull-refused');
});

test('5 line: record the return and settle; settlement contract, refund in seconds, access key revoked', async () => {
	// Deposit-free container: charges pulled to the line, nothing to refund, the key is revoked.
	await page.goto('/line/returns');
	await page.getByTestId(`record-return-${free.number}`).click();
	const drawer = page.getByRole('dialog', { name: /Record return of/ });
	await drawer.getByRole('textbox', { name: /EIR/ }).fill('EIR-MRDN-DEMO-02');
	await drawer.getByLabel('Depot').fill('Apapa Empty Depot');
	await drawer.getByRole('button', { name: 'Record return' }).click();
	const settle = page.getByTestId('settle-drawer');
	await expect(settle.getByTestId('settle-eir')).toHaveText('EIR-MRDN-DEMO-02');
	await expect(
		settle.getByRole('button', { name: /Settlement contract = recovery authority/ })
	).toBeVisible();
	await frame('14-line-record-return-deposit-free');
	await page.getByTestId('post-charges').click();
	const result = page.getByTestId('settle-result');
	await expect(result).toBeVisible();
	await expect(result.getByRole('button', { name: /Access key revoked/ })).toBeVisible();
	await expect(
		result.getByRole('button', { name: /Settlement contract = recovery authority/ })
	).toBeVisible();
	await expect(result.getByText(/Final in \d+ ms/)).toBeVisible();
	await frame('15-line-settled-access-key-revoked');
	await page.getByRole('dialog').getByRole('button', { name: 'Close' }).last().click();

	// Held container (Harbourview): two days past free time, so the line is owed detention and the
	// remainder is refunded in the same transaction.
	await demoPanel(true);
	for (const label of ['+1 day', '+1 day']) {
		const day = page.getByTestId('demo-controls').getByRole('button', { name: label, exact: true });
		await day.click();
		await expect(day).toBeEnabled();
	}
	await demoPanel(false);
	await page.goto('/line/returns');
	await page.getByTestId(`record-return-${held.numbers[0]}`).click();
	const drawer2 = page.getByRole('dialog', { name: /Record return of/ });
	await drawer2.getByRole('textbox', { name: /EIR/ }).fill('EIR-MRDN-DEMO-01');
	await drawer2.getByLabel('Depot').fill('Apapa Empty Depot');
	await drawer2.getByRole('button', { name: 'Record return' }).click();
	const settle2 = page.getByTestId('settle-drawer');
	await expect(settle2.getByTestId('settle-eir')).toHaveText('EIR-MRDN-DEMO-01');
	await expect(
		settle2.getByRole('button', { name: /Settlement contract = recovery authority/ })
	).toBeVisible();
	await frame('16-line-record-return-held');
	await page.getByTestId('post-charges').click();
	const result2 = page.getByTestId('settle-result');
	await expect(result2).toContainText(
		/Settled: \$(?!0\.00)[\d,.]+ to Meridian Ocean Lines,\s+\$[\d,.]+ refunded/
	);
	await expect(result2.getByRole('button', { name: /Refund in seconds/ })).toBeVisible();
	await expect(
		result2.getByRole('button', { name: /Settlement contract = recovery authority/ })
	).toBeVisible();
	await expect(result2.getByText(/Final in \d+ ms/)).toBeVisible();
	await expect(result2.getByText(/sim:0x/)).toBeVisible();
	await frame('17-line-settled-refund-in-seconds');
	await page.getByRole('dialog').getByRole('button', { name: 'Close' }).last().click();
});

test('6 held transfers: a stranger sends the wrong token; it is held and returned', async () => {
	await page.goto('/line/held');
	await expect(page.getByRole('tab', { name: /Held/ })).toContainText('2');
	await demoPanel(true);
	await page.getByRole('button', { name: /Simulate a stranger transfer \(BetaUSD\)/ }).click();
	await expect(page.getByRole('tab', { name: /Held/ })).toContainText('3');
	await expect(page.getByRole('table').getByText('Wrong token').first()).toBeVisible();
	await expect(tempoLabel(/Held, not lost/)).toBeVisible();
	await demoPanel(false);
	await frame('18-line-held-transfers-wrong-token');

	await page.getByTestId('return-to-sender').first().click();
	const result = page.getByTestId('return-result');
	await expect(result).toContainText('Returned');
	await expect(result.getByText(/Final in \d+ ms/)).toBeVisible();
	await expect(result.getByText(/sim:0x/)).toBeVisible();
	await expect(page.getByRole('tab', { name: /Held/ })).toContainText('2');
	await expect(tempoLabel(/Held, not lost/)).toBeVisible();
	await frame('19-line-held-transfer-returned');
});

test('close: importer dashboard shows cash freed and time from return to refund', async () => {
	await switchTo(page, 'tunde');
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
	await expect(page.getByText('Cash currently held')).toBeVisible();
	await expect(page.getByText('Cash freed, last 30 days')).toBeVisible();
	const avg = page.getByText('Average time from return to refund');
	await expect(avg).toBeVisible();
	await expect(tempoLabel(/Refund in seconds/)).toBeVisible();
	// The refund we just made is in the recent refunds table with its return-to-refund time.
	const refunds = page.getByRole('table', { name: 'Recent refunds' });
	await expect(refunds.getByRole('columnheader', { name: 'Return to refund' })).toBeVisible();
	await expect(refunds.getByRole('row').nth(1)).toContainText(/ms|second|s\b/);
	await frame('20-importer-dashboard-cash-freed');
});

test('close: the landing page Why Tempo panel shows four cards', async () => {
	await page.goto('/#why-tempo');
	const panel = page.locator('#why-tempo');
	await expect(panel).toBeVisible();
	const cards = panel.locator('article.tcard');
	await expect(cards).toHaveCount(4);
	for (const title of [
		'Access keys',
		'Receive policies and the guard',
		'Virtual addresses',
		'Memos, batch, fee sponsorship, passkeys'
	]) {
		await expect(panel.getByRole('heading', { name: title })).toBeVisible();
	}
	await panel.scrollIntoViewIfNeeded();
	await frame('21-landing-why-tempo');
});
