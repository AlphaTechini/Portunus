import { expect, type BrowserContext, type Page } from '@playwright/test';

/** Demo persona test ids are `persona-<first name, lower case>`. */
export const PERSONAS = {
	adaeze: { org: 'Meridian Ocean Lines', home: '/line', role: 'line' },
	joseph: { org: 'Kestrel Container Line', home: '/line', role: 'line' },
	tunde: { org: 'Harbourview Foods Ltd', home: '/importer', role: 'importer' },
	wanjiru: { org: 'Savanna Agro Traders', home: '/importer', role: 'importer' },
	carlo: { org: 'Pasig Valley Imports', home: '/importer', role: 'importer' },
	resolution: { org: 'Portunus Resolution Desk', home: '/disputes', role: 'platform' }
} as const;

export type PersonaKey = keyof typeof PERSONAS;

/** Open /signin and click a demo persona card. Resolves once the app shell is on screen. */
export async function signInAs(page: Page, persona: PersonaKey, next?: string) {
	await page.goto(next ? `/signin?next=${encodeURIComponent(next)}` : '/signin');
	await page.getByTestId(`persona-${persona}`).click();
	await expect(page.getByRole('navigation', { name: 'Main' }).first()).toBeVisible();
}

/** Attach a CTAP2 virtual authenticator (internal, resident keys, user verification) to the page. */
export async function addVirtualAuthenticator(context: BrowserContext, page: Page) {
	const cdp = await context.newCDPSession(page);
	await cdp.send('WebAuthn.enable');
	const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: {
			protocol: 'ctap2',
			transport: 'internal',
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			automaticPresenceSimulation: true
		}
	});
	return { cdp, authenticatorId };
}

/** Fail the test on uncaught page errors (console noise is ignored). */
export function failOnPageError(page: Page) {
	page.on('pageerror', (e) => {
		throw e;
	});
}

/** The organization name shown in the top bar. */
export function currentOrg(page: Page) {
	return page.getByRole('banner').locator('.org-name');
}
