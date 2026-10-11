import { afterEach, describe, expect, it, vi } from 'vitest';
import { Base64, Bytes, Hash, Hex } from 'ox';
import * as P256 from 'ox/P256';
import { keccak256 } from 'viem';
import { api, seeded, signIn, newBackend, freshNumber, type TestConvex } from './setup';
import { toUnits } from '../../src/lib/shared/domain/money';

afterEach(() => vi.useRealTimers());

/** A software authenticator: produces real WebAuthn assertions over a challenge. */
function authenticator() {
	const privateKey = P256.randomPrivateKey();
	const pub = P256.getPublicKey({ privateKey });
	const publicKey = Hex.concat(
		Hex.fromNumber(pub.x, { size: 32 }),
		Hex.fromNumber(pub.y, { size: 32 })
	);
	const address = `0x${keccak256(publicKey).slice(-40)}`;
	const credentialId = Base64.fromBytes(Bytes.random(16), { url: true, pad: false });
	const sign = (challenge: `0x${string}`, key = privateKey) => {
		const authData = Bytes.concat(
			Hash.sha256(Bytes.fromString('localhost'), { as: 'Bytes' }),
			Bytes.from([0x05]),
			Bytes.from([0, 0, 0, 1])
		);
		const clientDataJSON = JSON.stringify({
			type: 'webauthn.get',
			challenge: Base64.fromBytes(Bytes.fromHex(challenge), { url: true, pad: false }),
			origin: 'http://localhost:5173',
			crossOrigin: false
		});
		const payload = Bytes.concat(
			authData,
			Hash.sha256(Bytes.fromString(clientDataJSON), { as: 'Bytes' })
		);
		const sig = P256.sign({ payload, privateKey: key, hash: true });
		return {
			authenticatorData: Hex.fromBytes(authData),
			clientDataJSON,
			signatureR: sig.r.toString(),
			signatureS: sig.s.toString(),
			userVerificationRequired: true
		};
	};
	return { privateKey, publicKey, address, credentialId, sign };
}

async function register(
	t: TestConvex,
	a: ReturnType<typeof authenticator>,
	orgKind: 'line' | 'importer',
	orgName: string
) {
	return t.mutation(api.auth.registerPasskey, {
		name: 'Test User',
		email: 'test@example.com',
		orgName,
		orgKind,
		country: 'Ghana',
		credentialId: a.credentialId,
		publicKey: a.publicKey,
		address: a.address
	});
}

describe('passkey auth', () => {
	it('registers, signs in with a verified WebAuthn assertion, and rejects replays and forgeries', async () => {
		vi.useFakeTimers();
		const t = newBackend();
		const a = authenticator();
		const reg = await register(t, a, 'importer', 'Accra Fresh Imports');
		const me = await t.query(api.auth.me, { sessionToken: reg.sessionToken });
		expect(me!.user.hasPasskey).toBe(true);
		expect(me!.user.passkeyAddress).toBe(a.address);
		expect(me!.org.kind).toBe('importer');
		await expect(register(t, a, 'importer', 'Again')).rejects.toThrow(/already registered/);

		expect(await t.query(api.auth.passkeyPublicKey, { credentialId: a.credentialId })).toBe(
			a.publicKey
		);
		expect(await t.query(api.auth.passkeyPublicKey, { credentialId: 'unknown' })).toBeNull();

		await t.mutation(api.auth.signOut, { sessionToken: reg.sessionToken });
		expect(await t.query(api.auth.me, { sessionToken: reg.sessionToken })).toBeNull();

		const { challenge } = await t.mutation(api.auth.createChallenge, {});
		const good = a.sign(challenge as `0x${string}`);
		const signed = await t.mutation(api.auth.signInWithPasskey, {
			credentialId: a.credentialId,
			challenge,
			...good
		});
		expect(signed.verified).toBe(true);
		expect((await t.query(api.auth.me, { sessionToken: signed.sessionToken }))!.user.name).toBe(
			'Test User'
		);

		// The challenge is single use.
		await expect(
			t.mutation(api.auth.signInWithPasskey, { credentialId: a.credentialId, challenge, ...good })
		).rejects.toThrow(/UNAUTHENTICATED/);
		// A signature from another key does not verify.
		const { challenge: c2 } = await t.mutation(api.auth.createChallenge, {});
		const forged = a.sign(c2 as `0x${string}`, P256.randomPrivateKey());
		await expect(
			t.mutation(api.auth.signInWithPasskey, {
				credentialId: a.credentialId,
				challenge: c2,
				...forged
			})
		).rejects.toThrow(/could not be verified/);
		// A signature over a different challenge does not verify either.
		const { challenge: c3 } = await t.mutation(api.auth.createChallenge, {});
		const wrong = a.sign(c2 as `0x${string}`);
		await expect(
			t.mutation(api.auth.signInWithPasskey, {
				credentialId: a.credentialId,
				challenge: c3,
				...wrong
			})
		).rejects.toThrow(/could not be verified/);
		// Unknown challenge.
		await expect(
			t.mutation(api.auth.signInWithPasskey, {
				credentialId: a.credentialId,
				challenge: '0x00',
				...good
			})
		).rejects.toThrow(/UNAUTHENTICATED/);
	});

	it('a passkey user pays with a verified passkey approval; demo approval is refused for them', async () => {
		const t = await seeded();
		const adaeze = await signIn(t, 'Adaeze Okafor');
		const a = authenticator();
		const reg = await register(t, a, 'importer', 'Accra Fresh Imports');
		const org = (await t.query(api.auth.me, { sessionToken: reg.sessionToken }))!.org;
		const r = await t.mutation(api.releaseRequests.create, {
			sessionToken: adaeze,
			importerOrgId: org._id,
			billOfLading: 'MRDNTEMA4411',
			portOfDischarge: 'Tema',
			mode: 'held',
			containers: [{ number: freshNumber(), type: '20GP' }]
		});
		const preview = await t.query(api.deposits.preview, {
			sessionToken: reg.sessionToken,
			requestId: r.requestId
		});
		expect(preview.payer).toBe(a.address);
		expect(preview.sufficientBalance).toBe(true); // sim importers start with 250,000.00 AlphaUSD

		await expect(
			t.action(api.deposits.payBatch, {
				sessionToken: reg.sessionToken,
				requestId: r.requestId,
				approval: { method: 'demo' }
			})
		).rejects.toThrow(/APPROVAL_REQUIRED/);
		// an assertion over the wrong payload is refused
		const bad = a.sign(('0x' + '11'.repeat(32)) as `0x${string}`);
		await expect(
			t.action(api.deposits.payBatch, {
				sessionToken: reg.sessionToken,
				requestId: r.requestId,
				approval: { method: 'passkey', credentialId: a.credentialId, assertion: bad }
			})
		).rejects.toThrow(/could not be verified/);
		// a stale payload hash is refused
		await expect(
			t.action(api.deposits.payBatch, {
				sessionToken: reg.sessionToken,
				requestId: r.requestId,
				approval: { method: 'passkey', credentialId: a.credentialId, payloadHash: '0xabc' }
			})
		).rejects.toThrow(/changed/);
		const good = a.sign(preview.payloadHash as `0x${string}`);
		const paid = await t.action(api.deposits.payBatch, {
			sessionToken: reg.sessionToken,
			requestId: r.requestId,
			approval: {
				method: 'passkey',
				credentialId: a.credentialId,
				payloadHash: preview.payloadHash,
				assertion: good
			}
		});
		expect(paid.allCovered).toBe(true);
		const c = await t.query(api.containers.get, {
			sessionToken: reg.sessionToken,
			containerId: r.containerIds[0]
		});
		expect(c.payments[0]).toMatchObject({
			kind: 'deposit',
			approvedWith: 'passkey',
			from: a.address
		});
	});

	it('a new line is provisioned: deposits account, receive policy, rate cards', async () => {
		vi.useFakeTimers();
		const t = newBackend();
		const a = authenticator();
		const reg = await register(t, a, 'line', 'Gulf Star Shipping');
		const s = await t.query(api.orgs.lineSettings, { sessionToken: reg.sessionToken });
		expect(s.provisioned).toBe(true);
		expect(s.receivePolicy).toMatchObject({
			senderPolicy: 'reject-all',
			recoveryAuthority: s.settlementContract
		});
		expect(s.masterId).toMatch(/^0x5133d0/);
		expect(s.rateCards).toHaveLength(5);
		const cards = await t.query(api.rateCards.list, { sessionToken: reg.sessionToken });
		expect(cards.find((c) => c.containerType === '40HC')!.depositUnits).toBe(
			toUnits('2200').toString()
		);
		await t.mutation(api.rateCards.upsert, {
			sessionToken: reg.sessionToken,
			containerType: '40HC',
			freeDays: 10,
			dailyRateUnits: toUnits('90').toString(),
			depositUnits: toUnits('2500').toString()
		});
		const after = await t.query(api.rateCards.list, { sessionToken: reg.sessionToken });
		expect(after.find((c) => c.containerType === '40HC')).toMatchObject({
			freeDays: 10,
			dailyRateUnits: toUnits('90').toString()
		});
		await t.mutation(api.orgs.updateLineSettings, {
			sessionToken: reg.sessionToken,
			settlementWindowDays: 15
		});
		expect(
			(await t.query(api.orgs.lineSettings, { sessionToken: reg.sessionToken }))
				.settlementWindowDays
		).toBe(15);
		await expect(
			t.mutation(api.orgs.updateLineSettings, {
				sessionToken: reg.sessionToken,
				settlementWindowDays: 0
			})
		).rejects.toThrow(/INVALID/);
	});

	it('demo sign-in, personas and system status', async () => {
		const t = await seeded();
		const personas = await t.query(api.auth.listDemoPersonas, {});
		expect(personas.map((p) => p.name)).toContain('Adaeze Okafor');
		expect(personas).toHaveLength(6);
		const status = await t.query(api.system.status, {});
		expect(status).toMatchObject({
			chainMode: 'sim',
			chainId: 42431,
			settlementTokenSymbol: 'AlphaUSD',
			seeded: true
		});
		const tok = await signIn(t, 'Carlo Reyes');
		const me = await t.query(api.auth.me, { sessionToken: tok });
		expect(me!.org.name).toBe('Pasig Valley Imports');
		expect(await t.query(api.auth.me, { sessionToken: 'bogus' })).toBeNull();
	});
});

describe('demo persona order', () => {
	it('lists personas in demo recording order', async () => {
		const t = await seeded();
		const personas = await t.query(api.auth.listDemoPersonas, {});
		expect(personas.map((p) => p.name)).toEqual([
			'Adaeze Okafor',
			'Tunde Bakare',
			'Wanjiru Mwangi',
			'Carlo Reyes',
			'Joseph Otieno',
			'Resolution Desk'
		]);
		expect(personas.map((p) => p.orgKind)).toEqual([
			'line',
			'importer',
			'importer',
			'importer',
			'line',
			'platform'
		]);
	});
});
