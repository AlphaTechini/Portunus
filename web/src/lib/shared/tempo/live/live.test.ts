import { describe, expect, it } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, keccak256, toHex } from 'viem';
import { Abis, ReceivePolicyReceipt } from 'viem/tempo';
import {
	ALPHA_USD,
	RECEIVE_POLICY_GUARD,
	ZERO_MEMO,
	createVirtualAddress,
	decodeMemo,
	decryptSecret,
	describeChainError,
	encodeMemo,
	encryptSecret,
	heldReceiptsFromTxReceipt,
	idOfReceipt,
	isLimitExceeded,
	keychainErrorOf,
	normalizeMemo,
	parseEncryptionKey,
	parseVirtualAddress,
	toMs,
	toUnixSeconds,
	type Address,
	type Hex
} from './index';
import { settlementAbi, settlementBytecode } from '../settlementAbi';

describe('memo codec', () => {
	it('round-trips the documented memo grammar', () => {
		for (const s of [
			'PD MSCU1234567 MEDU12345678',
			'PC MSCU1234567 D03 MEDU1234',
			'PS MSCU1234567 EIR-778812',
			'PR MSCU1234567 EIR-778812',
			'PX 3f9a1c2b4d5e6f70'
		]) {
			const hex = encodeMemo(s);
			expect(hex).toMatch(/^0x[0-9a-f]{64}$/);
			expect(decodeMemo(hex)).toBe(s);
		}
	});

	it('right-pads with zero bytes', () => {
		const hex = encodeMemo('AB');
		expect(hex.startsWith('0x4142')).toBe(true);
		expect(hex.slice(6)).toBe('0'.repeat(60));
	});

	it('rejects memos longer than 32 bytes', () => {
		expect(() => encodeMemo('x'.repeat(33))).toThrow(/32 bytes/);
		expect(() => encodeMemo('é'.repeat(17))).toThrow(/32 bytes/); // 34 bytes in UTF-8
	});

	it('normalizeMemo accepts text, bytes32 hex and empty', () => {
		expect(normalizeMemo('')).toBe(ZERO_MEMO);
		expect(normalizeMemo(undefined)).toBe(ZERO_MEMO);
		const hex = encodeMemo('PD X');
		expect(normalizeMemo(hex)).toBe(hex);
		expect(normalizeMemo('PD X')).toBe(hex);
	});
});

describe('AES-GCM secret storage', () => {
	const key = `0x${'ab'.repeat(32)}`;

	it('round-trips a private key', async () => {
		const pk = `0x${'12'.repeat(32)}`;
		const enc = await encryptSecret(pk, key);
		expect(enc.startsWith('v1.')).toBe(true);
		expect(enc).not.toContain(pk.slice(2));
		expect(await decryptSecret(enc, key)).toBe(pk);
	});

	it('uses a fresh IV every time', async () => {
		const a = await encryptSecret('secret', key);
		const b = await encryptSecret('secret', key);
		expect(a).not.toBe(b);
	});

	it('fails with the wrong key or a tampered payload', async () => {
		const enc = await encryptSecret('secret', key);
		await expect(decryptSecret(enc, `0x${'cd'.repeat(32)}`)).rejects.toThrow(/could not decrypt/);
		const parts = enc.split('.');
		const tampered = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -2)}AA`;
		await expect(decryptSecret(tampered, key)).rejects.toThrow(/could not decrypt/);
		await expect(decryptSecret('garbage', key)).rejects.toThrow(/format/);
	});

	it('accepts hex (with or without 0x) and base64 keys, rejects other lengths', async () => {
		const bytes = parseEncryptionKey(key);
		expect(bytes).toHaveLength(32);
		expect(parseEncryptionKey('ab'.repeat(32))).toEqual(bytes);
		const b64 = btoa(String.fromCharCode(...bytes));
		expect(parseEncryptionKey(b64)).toEqual(bytes);
		expect(() => parseEncryptionKey('0x1234')).toThrow(/32 bytes/);
		expect(() => parseEncryptionKey('')).toThrow(/32 bytes/);
	});
});

// A ClaimReceiptV1 for a deposit paid by `originator` to a virtual address under `master`.
const settlement = '0x00000000000000000000000000000000000050E1' as Address;
const originator = '0x1111111111111111111111111111111111111111' as Address;
const master = '0x2222222222222222222222222222222222222222' as Address;
const depositAddress = createVirtualAddress({ masterId: '0x82bfcada', envPrefix: 0xabcd, containerSeq: 7 });

function sampleReceipt(memo: Hex = encodeMemo('PD MSCU1234567 MEDU12345678')): Hex {
	return ReceivePolicyReceipt.encode({
		version: 1,
		token: ALPHA_USD,
		recoveryAuthority: settlement,
		originator,
		recipient: depositAddress,
		blockedAt: 1_790_000_000n,
		blockedNonce: 5n,
		blockedReason: 'receivePolicy',
		kind: 'transfer',
		memo
	});
}

function blockedLog(receipt: Hex, amount: bigint, logIndex: number) {
	const topics = encodeEventTopics({
		abi: Abis.receivePolicyGuard,
		eventName: 'TransferBlocked',
		args: { token: ALPHA_USD, receiver: master, blockedNonce: 5n }
	});
	const data = encodeAbiParameters(
		[
			{ type: 'uint256', name: 'amount' },
			{ type: 'uint8', name: 'receiptVersion' },
			{ type: 'bytes', name: 'receipt' }
		],
		[amount, 1, receipt]
	);
	return {
		address: RECEIVE_POLICY_GUARD,
		topics,
		data,
		blockNumber: 1234n,
		transactionHash: `0x${'ee'.repeat(32)}` as Hex,
		transactionIndex: 0,
		blockHash: `0x${'dd'.repeat(32)}` as Hex,
		logIndex,
		removed: false
	};
}

describe('guard receipts', () => {
	it('receipt encodes to exactly 320 bytes (the settlement contract length check)', () => {
		const r = sampleReceipt();
		expect((r.length - 2) / 2).toBe(320);
	});

	it('decodes TransferBlocked logs from a transaction receipt, in log order', () => {
		const r1 = sampleReceipt(encodeMemo('PD MSCU1234567 BL1'));
		const r2 = sampleReceipt(encodeMemo('PD MSCU7654321 BL1'));
		const txReceipt = {
			transactionHash: `0x${'ee'.repeat(32)}` as Hex,
			logs: [
				// An unrelated log (ordinary Transfer to the guard) must be ignored.
				{ ...blockedLog(r1, 1n, 0), address: ALPHA_USD, topics: [`0x${'11'.repeat(32)}`] as [Hex] },
				blockedLog(r1, 500_000_000n, 1),
				blockedLog(r2, 1_200_000_000n, 3)
			]
		};
		const held = heldReceiptsFromTxReceipt(txReceipt as never);
		expect(held).toHaveLength(2);
		expect(held[0]).toMatchObject({
			id: keccak256(r1),
			receipt: r1,
			token: ALPHA_USD.toLowerCase(),
			amount: '500000000',
			receiver: master.toLowerCase(),
			recoveryAuthority: settlement.toLowerCase(),
			blockedAt: 1_790_000_000_000,
			blockedAtSec: 1_790_000_000,
			blockedReason: 'receivePolicy',
			logIndex: 1,
			blockNumber: '1234'
		});
		expect(held[0].originator).toBe(originator);
		expect(held[0].recipient).toBe(depositAddress.toLowerCase());
		expect(decodeMemo(held[0].memo)).toBe('PD MSCU1234567 BL1');
		expect(held[1].amount).toBe('1200000000');
		expect(held[1].logIndex).toBe(3);
		expect(held[1].id).toBe(idOfReceipt(r2));
		// JSON-safe across the Convex boundary: no bigint anywhere.
		expect(() => JSON.stringify(held)).not.toThrow();
	});
});

describe('virtual addresses', () => {
	it('derives per-container addresses that parse back', () => {
		const a = createVirtualAddress({ masterId: '0x82bfcada', envPrefix: 0xabcd, containerSeq: 7 });
		const b = createVirtualAddress({ masterId: '0x82bfcada', envPrefix: 0xabcd, containerSeq: 8 });
		const c = createVirtualAddress({ masterId: '0x82bfcada', envPrefix: 0x0001, containerSeq: 7 });
		expect(new Set([a, b, c]).size).toBe(3);
		expect(a.toLowerCase().startsWith('0x82bfcadafdfdfdfdfdfdfdfdfdfd')).toBe(true);
		expect(parseVirtualAddress(a)).toMatchObject({ masterId: '0x82bfcada', envPrefix: 0xabcd, containerSeq: 7 });
		expect(parseVirtualAddress(master)).toBeNull();
	});

	it('rejects out-of-range prefixes and sequences', () => {
		expect(() => createVirtualAddress({ masterId: '0x82bfcada', envPrefix: 70000, containerSeq: 1 })).toThrow();
		expect(() => createVirtualAddress({ masterId: '0x82bfcada', envPrefix: 1, containerSeq: 2 ** 32 })).toThrow();
	});
});

describe('chain error classification', () => {
	it('detects SpendingLimitExceeded by name or selector anywhere in the cause chain', () => {
		expect(isLimitExceeded(new Error('execution reverted: SpendingLimitExceeded()'))).toBe(true);
		const nested = Object.assign(new Error('Execution reverted for an unknown reason.'), {
			cause: { shortMessage: 'reverted', data: '0xe9a36a4b' }
		});
		expect(isLimitExceeded(nested)).toBe(true);
		expect(keychainErrorOf(new Error('KeyExpired()'))).toBe('KeyExpired');
		expect(keychainErrorOf(new Error('0x90800d35'))).toBe('CallNotAllowed');
		expect(isLimitExceeded(new Error('HTTP request failed'))).toBe(false);
		expect(describeChainError(new Error('SpendingLimitExceeded'))).toMatch(/SpendingLimitExceeded/);
	});
});

describe('timestamps', () => {
	it('accepts seconds or milliseconds', () => {
		expect(toUnixSeconds(1_790_000_000)).toBe(1_790_000_000);
		expect(toUnixSeconds(1_790_000_000_123)).toBe(1_790_000_000);
		expect(toMs(1_790_000_000)).toBe(1_790_000_000_000);
		expect(toMs(1_790_000_000_123)).toBe(1_790_000_000_123);
	});
});

describe('settlement ABI', () => {
	const fns = settlementAbi.filter((x) => x.type === 'function');
	const byName = (n: string) => fns.find((f) => f.name === n);

	it('exposes the brief section 9 interface', () => {
		for (const n of [
			'settle',
			'settleMany',
			'returnToSender',
			'resolveDispute',
			'refundAfterDeadline',
			'statusOf',
			'idOf',
			'depositsAccount',
			'charges',
			'operator',
			'resolver',
			'token',
			'maxHold'
		]) {
			expect(byName(n), n).toBeDefined();
		}
		const events = settlementAbi.filter((x) => x.type === 'event').map((e) => e.name);
		expect(events).toEqual(expect.arrayContaining(['Settled', 'Returned', 'DisputeResolved']));
	});

	it('settle takes (receipt, charge, disputed, chargeMemo, refundMemo)', () => {
		expect(byName('settle')!.inputs.map((i) => i.type)).toEqual([
			'bytes',
			'uint256',
			'uint256',
			'bytes32',
			'bytes32'
		]);
		expect(byName('settleMany')!.inputs.map((i) => i.type)).toEqual([
			'bytes[]',
			'uint256[]',
			'uint256[]',
			'bytes32[]',
			'bytes32[]'
		]);
	});

	it('no state-changing function takes a destination address', () => {
		const writes = fns.filter((f) => f.stateMutability === 'nonpayable' || f.stateMutability === 'payable');
		expect(writes.map((w) => w.name).sort()).toEqual(
			['refundAfterDeadline', 'resolveDispute', 'returnToSender', 'settle', 'settleMany'].sort()
		);
		for (const w of writes) {
			for (const input of w.inputs) {
				expect(input.type, `${w.name}.${input.name}`).not.toMatch(/address/);
			}
		}
	});

	it('ships real bytecode', () => {
		expect(settlementBytecode).toMatch(/^0x[0-9a-f]+$/);
		expect(settlementBytecode.length).toBeGreaterThan(2000);
		expect(toHex(0)).toBe('0x0'); // sanity that viem is wired in this runtime
	});
});
