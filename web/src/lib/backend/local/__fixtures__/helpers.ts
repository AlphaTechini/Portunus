/* eslint-disable @typescript-eslint/no-explicit-any */
import { anyApi } from 'convex/server';
import * as app from './app.js';
import * as crons from './crons.js';
import * as schema from './schema.js';
import { LocalRuntime, type LocalRuntimeOptions } from '../runtime.js';

export const api = anyApi as any;

export function memoryStorage() {
	const m = new Map<string, string>();
	return {
		m,
		getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
		setItem: (k: string, v: string) => void m.set(k, v),
		removeItem: (k: string) => void m.delete(k)
	};
}

export function fixtureModules() {
	return { 'app.ts': app, 'schema.ts': schema, 'crons.ts': crons } as Record<string, any>;
}

export function makeRuntime(opts: Partial<LocalRuntimeOptions> = {}) {
	return new LocalRuntime({
		modules: fixtureModules(),
		leader: 'always',
		storage: null,
		createChannel: null,
		log: () => {},
		...opts
	});
}
