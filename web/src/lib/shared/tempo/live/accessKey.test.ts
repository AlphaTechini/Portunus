import { describe, expect, it } from 'vitest';
import { generatePrivateKey } from 'viem/accounts';
import { Account, Period } from 'viem/tempo';
import {
	ALPHA_USD,
	CHAIN_ID,
	SECONDS_PER_DAY,
	TRANSFER_WITH_MEMO_SIGNATURE,
	decryptSecret,
	encryptSecret,
	type Address,
	type Hex
} from './index';

// What createAccessKey stores and what the browser authorizes must be the same key, and the authorization the
// browser signs must carry the limits and scope the product promises. Offline checks (no chain needed).
describe('access key lifecycle (offline)', () => {
	const encKey = `0x${'7e'.repeat(32)}`;
	const importer = Account.fromSecp256k1(generatePrivateKey()); // stands in for the passkey root account
	const charges = '0x00000000000000000000000000000000000c0de0' as Address;

	it('the address handed to the browser is the key the server later signs with', async () => {
		const pk = generatePrivateKey();
		const keyAddress = Account.fromSecp256k1(pk).address; // createAccessKey
		const stored = await encryptSecret(pk, encKey);
		const restored = (await decryptSecret(stored, encKey)) as Hex;
		const lineKey = Account.fromSecp256k1(restored, { access: importer.address }); // pullDetention
		expect(lineKey.accessKeyAddress.toLowerCase()).toBe(keyAddress.toLowerCase());
		expect(lineKey.address.toLowerCase()).toBe(importer.address.toLowerCase()); // tx.from = the importer
	});

	it('signs a key authorization with a daily limit, a recipient scope and an expiry', async () => {
		const keyAddress = Account.fromSecp256k1(generatePrivateKey()).address;
		const expiry = Math.floor(Date.now() / 1000) + 14 * SECONDS_PER_DAY;
		const auth = await importer.signKeyAuthorization(
			{ address: keyAddress, type: 'secp256k1' },
			{
				chainId: BigInt(CHAIN_ID),
				expiry,
				limits: [{ token: ALPHA_USD, limit: 45_000_000n, period: Period.days(1) }],
				scopes: [
					{ address: ALPHA_USD, selector: TRANSFER_WITH_MEMO_SIGNATURE, recipients: [charges] }
				]
			}
		);
		expect(auth.address.toLowerCase()).toBe(keyAddress.toLowerCase());
		expect(Number(auth.expiry)).toBe(expiry);
		expect(auth.limits).toHaveLength(1);
		expect(auth.limits![0].limit).toBe(45_000_000n);
		expect(Number(auth.limits![0].period)).toBe(SECONDS_PER_DAY);
		expect(auth.scopes).toHaveLength(1);
		expect(auth.scopes![0].recipients?.map((r) => r.toLowerCase())).toEqual([
			charges.toLowerCase()
		]);
		expect(auth.signature).toBeDefined();
	});
});
