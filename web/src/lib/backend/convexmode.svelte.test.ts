// Runs in the 'svelte' vitest project, see vitest.runtime.config.ts
import { describe, expect, it, vi } from 'vitest';

const setupConvex = vi.fn();
const client = {
	query: vi.fn(async (...a: unknown[]) => (void a, 'q')),
	mutation: vi.fn(async (...a: unknown[]) => (void a, 'm')),
	action: vi.fn(async (...a: unknown[]) => (void a, 'a')),
	onUpdate: vi.fn(() => () => {})
};

vi.mock('$app/env', () => ({ browser: true, dev: true, building: false, version: 'test' }));
vi.mock('$app/env/public', () => ({ PUBLIC_CONVEX_URL: 'https://example.convex.cloud' }));
vi.mock('convex-svelte', () => ({
	setupConvex,
	getConvexClient: () => client,
	useQuery: vi.fn(() => ({ data: 'convex' })),
	useMutation: (ref: unknown) => (args: unknown, options: unknown) =>
		client.mutation(ref as never, args as never, options as never),
	useAction: (ref: unknown) => (args: unknown) => client.action(ref as never, args as never)
}));

describe('convex mode', () => {
	it('delegates to convex-svelte and never starts the local runtime', async () => {
		const m = await import('./index.js');
		const { hasLocalRuntime } = await import('./local/browser.js');
		expect(m.backendMode).toBe('convex');
		m.setupBackend();
		expect(setupConvex).toHaveBeenCalledWith('https://example.convex.cloud');
		expect(await m.getBackend().query({} as never, {} as never)).toBe('q');
		expect(await m.useMutation({} as never)({} as never)).toBe('m');
		expect(await m.useAction({} as never)({} as never)).toBe('a');
		expect(m.useQuery({} as never, {} as never).data).toBe('convex');
		expect(hasLocalRuntime()).toBe(false);
	});
});
