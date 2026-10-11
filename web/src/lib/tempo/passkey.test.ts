import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	PasskeyError,
	approveWithPasskey,
	createPasskey,
	getPasskeyAssertion,
	isPasskeySupported
} from './passkey';

const g = globalThis as unknown as Record<string, unknown>;

function fakeBrowser(opts: { hostname?: string; secure?: boolean; get?: () => Promise<unknown> }) {
	const navigator = {
		credentials: { get: opts.get ?? (async () => null), create: async () => null }
	};
	g.window = {
		location: { hostname: opts.hostname ?? 'localhost' },
		isSecureContext: opts.secure ?? true,
		PublicKeyCredential: function PublicKeyCredential() {},
		navigator
	};
	Object.defineProperty(globalThis, 'navigator', { configurable: true, value: navigator });
}

afterEach(() => {
	delete g.window;
	Reflect.deleteProperty(globalThis, 'navigator');
	vi.restoreAllMocks();
});

const code = async (p: Promise<unknown>) => {
	try {
		await p;
	} catch (e) {
		expect(e).toBeInstanceOf(PasskeyError);
		return (e as PasskeyError).code;
	}
	throw new Error('expected a PasskeyError');
};

describe('passkey guards', () => {
	it('refuses to run during SSR', async () => {
		expect(isPasskeySupported()).toBe(false);
		expect(await code(createPasskey('Acme'))).toBe('SSR');
		expect(await code(getPasskeyAssertion('0x1234'))).toBe('SSR');
		expect(await code(approveWithPasskey('0x1234'))).toBe('SSR');
	});

	it('explains unsupported browsers', async () => {
		g.window = { location: { hostname: 'localhost' }, isSecureContext: true };
		expect(await code(createPasskey('Acme'))).toBe('UNSUPPORTED');
	});

	it('rejects IP-address hosts and insecure pages with a clear message', async () => {
		fakeBrowser({ hostname: '127.0.0.1' });
		await expect(createPasskey('Acme')).rejects.toThrow(/localhost/);
		expect(await code(createPasskey('Acme'))).toBe('INSECURE');
		fakeBrowser({ hostname: 'example.com', secure: false });
		expect(await code(createPasskey('Acme'))).toBe('INSECURE');
	});

	it('maps a dismissed prompt to CANCELLED', async () => {
		fakeBrowser({
			get: async () => {
				throw new DOMException(
					'The operation either timed out or was not allowed.',
					'NotAllowedError'
				);
			}
		});
		expect(await code(getPasskeyAssertion(`0x${'ab'.repeat(32)}`))).toBe('CANCELLED');
		expect(await code(approveWithPasskey(`0x${'cd'.repeat(32)}`, { credentialId: 'abc' }))).toBe(
			'CANCELLED'
		);
	});

	it('reports other failures as FAILED with the underlying message', async () => {
		fakeBrowser({
			get: async () => {
				throw new Error('authenticator exploded');
			}
		});
		await expect(getPasskeyAssertion(`0x${'ab'.repeat(32)}`)).rejects.toThrow(
			/authenticator exploded/
		);
	});
});
