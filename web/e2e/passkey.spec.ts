import { expect, test } from '@playwright/test';
import { addVirtualAuthenticator, currentOrg } from './helpers';

test('create an account with a passkey, sign out, and sign in again with it', async ({
	page,
	context
}) => {
	await addVirtualAuthenticator(context, page);

	await page.goto('/signin');
	await page.getByRole('button', { name: /Create a passkey/ }).click();
	await page.getByLabel('Your name').fill('Amara Okeke');
	await page.getByRole('textbox', { name: /^Organization/ }).fill('Harbourline Clearing');
	await page.getByRole('radio', { name: 'Importer' }).click();
	await page.getByRole('button', { name: /Create account with passkey/ }).click();

	await expect(page).toHaveURL(/\/importer$/);
	await expect(currentOrg(page)).toHaveText('Harbourline Clearing');
	await page.getByTestId('user-menu-button').click();
	await expect(page.getByTestId('user-name')).toHaveText('Amara Okeke');
	await expect(page.getByText('Signed in with passkey')).toBeVisible();
	await page.getByTestId('sign-out').click();
	await expect(page).toHaveURL(/\/signin$/);

	await page.getByRole('button', { name: /Sign in with passkey/ }).click();
	await expect(page).toHaveURL(/\/importer$/);
	await page.getByTestId('user-menu-button').click();
	await expect(page.getByTestId('user-name')).toHaveText('Amara Okeke');
});

test('a shipping line account created with a passkey lands on the line dashboard', async ({
	page,
	context
}) => {
	await addVirtualAuthenticator(context, page);
	await page.goto('/signin');
	await page.getByRole('button', { name: /Create a passkey/ }).click();
	await page.getByLabel('Your name').fill('Kofi Mensah');
	await page.getByRole('textbox', { name: /^Organization/ }).fill('Gulf Star Lines');
	await page.getByRole('radio', { name: 'Shipping line' }).click();
	await page.getByRole('button', { name: /Create account with passkey/ }).click();
	await expect(page).toHaveURL(/\/line$/);
	await expect(currentOrg(page)).toHaveText('Gulf Star Lines');
});

test('registration asks for a name and an organization first', async ({ page, context }) => {
	await addVirtualAuthenticator(context, page);
	await page.goto('/signin');
	await page.getByRole('button', { name: /Create a passkey/ }).click();
	await page.getByRole('button', { name: /Create account with passkey/ }).click();
	await expect(page.getByText('Enter your name.')).toBeVisible();
	await expect(page.getByText('Enter your organization.')).toBeVisible();
	await expect(page).toHaveURL(/\/signin$/);
});

test('cancelling the passkey prompt shows a calm message and allows a retry', async ({ page }) => {
	// No authenticator attached: the browser prompt fails the way a dismissed prompt does.
	await page.addInitScript(() => {
		navigator.credentials.get = () =>
			Promise.reject(new DOMException('cancelled', 'NotAllowedError'));
	});
	await page.goto('/signin');
	await page.getByRole('button', { name: /Sign in with passkey/ }).click();
	await expect(page.getByRole('alert')).toContainText('Not completed');
	await expect(page.getByRole('button', { name: /Not completed/ })).toBeEnabled();
});

test('unsupported passkeys show guidance and keep the demo personas usable', async ({ page }) => {
	await page.addInitScript(() => {
		// @ts-expect-error simulate a browser without WebAuthn
		delete window.PublicKeyCredential;
	});
	await page.goto('/signin');
	await expect(page.getByText('Passkeys are not available here')).toBeVisible();
	await page.getByTestId('persona-tunde').click();
	await expect(page).toHaveURL(/\/importer$/);
});
