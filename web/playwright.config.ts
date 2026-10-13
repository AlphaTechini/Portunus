import { defineConfig, devices } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * End-to-end tests run against the dev server in the in-browser "local" backend (no network).
 * WebAuthn needs a real hostname, so the base URL is localhost, never 127.0.0.1.
 *
 * The Chromium build installed in this environment lives under PLAYWRIGHT_BROWSERS_PATH. If its
 * revision does not match @playwright/test, point Playwright at the executable directly.
 * Never run `playwright install`.
 */
function findChromium(): string | undefined {
	const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
	if (!existsSync(root)) return undefined;
	const dirs = readdirSync(root)
		.filter((d) => /^chromium-\d+$/.test(d))
		.sort()
		.reverse();
	for (const d of dirs) {
		const exe = join(root, d, 'chrome-linux', 'chrome');
		if (existsSync(exe)) return exe;
	}
	return undefined;
}

const executablePath = process.env.PW_CHROMIUM_PATH ?? findChromium();

export default defineConfig({
	testDir: './e2e',
	outputDir: './.playwright/results',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	workers: process.env.CI ? 2 : undefined,
	timeout: 45_000,
	expect: { timeout: 10_000 },
	reporter: [['list']],
	use: {
		baseURL: 'http://localhost:5173',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		viewport: { width: 1440, height: 900 },
		launchOptions: executablePath ? { executablePath } : {}
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }
		}
	],
	webServer: {
		command: 'pnpm dev --port 5173 --host localhost',
		url: 'http://localhost:5173',
		reuseExistingServer: !process.env.CI,
		timeout: 120_000
	}
});
