import { describe, expect, it } from 'vitest';
import { addresses, convexEnvLines, ensureKeys, publicConfig, type TempoState } from './lib/state';

describe('setup state helpers', () => {
	it('ensureKeys fills every key once and never replaces existing ones', () => {
		const s = ensureKeys({});
		const copy = JSON.stringify(s);
		for (const k of [
			'sponsorKey',
			'operatorKey',
			'depositsKey',
			'chargesKey',
			'resolverKey',
			'accessKeyEncKey'
		] as const) {
			expect(s[k]).toMatch(/^0x[0-9a-f]{64}$/);
		}
		expect(s.vaEnvPrefix).toBeGreaterThanOrEqual(0);
		expect(s.vaEnvPrefix).toBeLessThanOrEqual(0xffff);
		expect(JSON.stringify(ensureKeys(s))).toBe(copy);
	});

	it('prints every Convex env variable the node actions read', () => {
		const s: TempoState = {
			...ensureKeys({}),
			masterId: '0x82bfcada',
			settlement: '0x00000000000000000000000000000000000050e1'
		};
		const lines = convexEnvLines(s).join('\n');
		for (const name of [
			'TEMPO_MODE',
			'TEMPO_RPC_URL',
			'TEMPO_SPONSOR_KEY',
			'TEMPO_OPERATOR_KEY',
			'TEMPO_RESOLVER_KEY',
			'LINE_DEPOSITS_KEY',
			'ACCESS_KEY_ENC_KEY',
			'PORTUNUS_MASTER_ID',
			'PORTUNUS_SETTLEMENT',
			'PORTUNUS_CHARGES',
			'PORTUNUS_DEPOSITS_ACCOUNT',
			'VA_ENV_PREFIX'
		]) {
			expect(lines, name).toContain(`npx convex env set ${name} `);
		}
		expect(lines).toContain("TEMPO_MODE 'live'");
		expect(lines).toContain(`PORTUNUS_CHARGES '${addresses(s).charges}'`);
	});

	it('public config carries no private keys', () => {
		const s = ensureKeys({});
		const json = JSON.stringify(publicConfig(s));
		for (const k of [
			s.sponsorKey,
			s.operatorKey,
			s.depositsKey,
			s.chargesKey,
			s.resolverKey,
			s.accessKeyEncKey
		]) {
			expect(json).not.toContain(k!.slice(2));
		}
	});
});
