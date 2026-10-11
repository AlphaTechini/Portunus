// Offline tests for contracts/PortunusSettlement.sol:
//  1. it compiles, and the committed settlementAbi.ts is up to date with the .sol file;
//  2. its behaviour, executed in a JS EVM against Solidity stand-ins for the Tempo precompiles
//     (guard, address registry, TIP-20). This cannot prove behaviour on Moderato; see docs/LIVE-SETUP.md.
import solc from 'solc';
import { beforeEach, describe, expect, it } from 'vitest';
import { createEVM, type EVM } from '@ethereumjs/evm';
import {
	createAddressFromString,
	hexToBytes,
	bytesToHex,
	type Address as EAddress
} from '@ethereumjs/util';
import {
	decodeErrorResult,
	decodeEventLog,
	encodeAbiParameters,
	encodeDeployData,
	encodeFunctionData,
	keccak256,
	parseAbi,
	type Abi,
	type Hex
} from 'viem';
import { ReceivePolicyReceipt, VirtualAddress } from 'viem/tempo';
import { compileSettlement } from './lib/solc';
import { MOCKS_SOURCE } from './lib/mocks';
import { settlementAbi, settlementBytecode } from '../src/lib/shared/tempo/settlementAbi';

const GUARD = '0xB10C000000000000000000000000000000000000' as const;
const REGISTRY = '0xfDC0000000000000000000000000000000000000' as const;
const TOKEN = '0x20c0000000000000000000000000000000000001' as const;
const WRONG_TOKEN = '0x20c0000000000000000000000000000000000002' as const;
const DEPOSITS = '0x00000000000000000000000000000000000d0001' as const;
const CHARGES = '0x00000000000000000000000000000000000c0002' as const;
const OPERATOR = '0x00000000000000000000000000000000000a0003' as const;
const RESOLVER = '0x00000000000000000000000000000000000b0004' as const;
const IMPORTER = '0x0000000000000000000000000000000000001001' as const;
const STRANGER = '0x0000000000000000000000000000000000009999' as const;
const MAX_HOLD = 30n * 86_400n;
const U = 1_000_000n; // 1.00 AlphaUSD

describe('compile', () => {
	it('compiles with solc 0.8.28 and matches the committed settlementAbi.ts', () => {
		const c = compileSettlement();
		expect(c.solcVersion).toContain('0.8.28');
		expect(c.evmVersion).toBe('cancun');
		expect(c.bytecode).toBe(settlementBytecode);
		expect(JSON.stringify(c.abi)).toBe(JSON.stringify(settlementAbi));
	});
});

// ---------------------------------------------------------------------------------------------------------------

interface Compiled {
	abi: Abi;
	creation: Hex;
	runtime: Hex;
}
function compileMocks(): Record<'MockToken' | 'MockGuard' | 'MockRegistry', Compiled> {
	const out = JSON.parse(
		solc.compile(
			JSON.stringify({
				language: 'Solidity',
				sources: { 'Mocks.sol': { content: MOCKS_SOURCE } },
				settings: {
					optimizer: { enabled: true, runs: 200 },
					evmVersion: 'cancun',
					outputSelection: {
						'*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] }
					}
				}
			})
		)
	);
	const errors = (out.errors ?? []).filter((e: { severity: string }) => e.severity === 'error');
	if (errors.length)
		throw new Error(errors.map((e: { formattedMessage: string }) => e.formattedMessage).join('\n'));
	const pick = (n: string): Compiled => ({
		abi: out.contracts['Mocks.sol'][n].abi,
		creation: `0x${out.contracts['Mocks.sol'][n].evm.bytecode.object}`,
		runtime: `0x${out.contracts['Mocks.sol'][n].evm.deployedBytecode.object}`
	});
	return {
		MockToken: pick('MockToken'),
		MockGuard: pick('MockGuard'),
		MockRegistry: pick('MockRegistry')
	};
}

const mocks = compileMocks();
const guardAbi = mocks.MockGuard.abi;
const tokenAbi = mocks.MockToken.abi;
const registryAbi = mocks.MockRegistry.abi;
const allErrorsAbi = [...settlementAbi, ...tokenAbi, ...guardAbi] as Abi;

const addr = (a: string): EAddress => createAddressFromString(a.toLowerCase());

class Chain {
	evm!: EVM;
	settlement!: Hex;
	timestamp = 1_800_000_000n;
	nonce = 5n;

	static async create() {
		const c = new Chain();
		c.evm = await createEVM();
		const put = (a: string, code: Hex) => c.evm.stateManager.putCode(addr(a), hexToBytes(code));
		await put(TOKEN, mocks.MockToken.runtime);
		await put(WRONG_TOKEN, mocks.MockToken.runtime);
		await put(GUARD, mocks.MockGuard.runtime);
		await put(REGISTRY, mocks.MockRegistry.runtime);
		const deployed = await c.evm.runCall({
			caller: addr(OPERATOR),
			data: hexToBytes(
				encodeDeployData({
					abi: settlementAbi,
					bytecode: settlementBytecode,
					args: [DEPOSITS, CHARGES, OPERATOR, RESOLVER, TOKEN, MAX_HOLD]
				})
			),
			gasLimit: 30_000_000n
		});
		if (deployed.execResult.exceptionError) throw new Error('deploy failed');
		c.settlement = deployed.createdAddress!.toString() as Hex;
		return c;
	}

	async call(from: string, to: string, abi: Abi, functionName: string, args: unknown[] = []) {
		const res = await this.evm.runCall({
			caller: addr(from),
			to: addr(to),
			data: hexToBytes(encodeFunctionData({ abi, functionName, args } as never)),
			gasLimit: 30_000_000n,
			block: { header: { number: 100n, timestamp: this.timestamp } } as never
		});
		const r = res.execResult;
		const data = bytesToHex(r.returnValue);
		if (r.exceptionError) {
			let name: string;
			try {
				name = decodeErrorResult({ abi: allErrorsAbi, data }).errorName;
			} catch {
				name = `revert(${data})`;
			}
			return { ok: false as const, error: name, data, logs: [] as never[] };
		}
		return { ok: true as const, data, logs: r.logs ?? [] };
	}

	async ok(...a: Parameters<Chain['call']>) {
		const r = await this.call(...a);
		if (!r.ok) throw new Error(`${a[3]} reverted: ${r.error}`);
		return r;
	}

	async balance(token: string, who: string): Promise<bigint> {
		const r = await this.ok(STRANGER, token, tokenAbi, 'balanceOf', [who]);
		return BigInt(r.data);
	}

	/** Creates a held deposit: a receipt for `amount`, blocked by the guard, recovery authority = settlement. */
	async hold(opts: {
		amount: bigint;
		token?: string;
		recipient?: string;
		authority?: string;
		originator?: string;
		memo?: Hex;
		blockedAt?: bigint;
		extraBytes?: boolean;
	}): Promise<Hex> {
		this.nonce += 1n;
		let receipt = ReceivePolicyReceipt.encode({
			version: 1,
			token: (opts.token ?? TOKEN) as Hex,
			recoveryAuthority: (opts.authority ?? this.settlement) as Hex,
			originator: (opts.originator ?? IMPORTER) as Hex,
			recipient: (opts.recipient ?? DEPOSITS) as Hex,
			blockedAt: opts.blockedAt ?? this.timestamp,
			blockedNonce: this.nonce,
			blockedReason: 'receivePolicy',
			kind: 'transfer',
			memo: opts.memo ?? `0x${'00'.repeat(32)}`
		});
		await this.ok(STRANGER, GUARD, guardAbi, 'hold', [receipt, opts.amount]);
		if (opts.extraBytes) receipt = `${receipt}00`;
		return receipt;
	}

	settle(from: string, receipt: Hex, charge: bigint, disputed: bigint, cm = '0x01', rm = '0x02') {
		return this.call(from, this.settlement, settlementAbi as Abi, 'settle', [
			receipt,
			charge,
			disputed,
			pad(cm),
			pad(rm)
		]);
	}
	status(receipt: Hex) {
		return this.ok(STRANGER, this.settlement, settlementAbi as Abi, 'statusOf', [
			keccak256(receipt)
		]).then((r) => Number(BigInt(r.data)));
	}
}

const pad = (h: string): Hex => `0x${h.replace(/^0x/, '').padStart(64, '0')}`;

const events = (logs: { 1: Uint8Array[]; 2: Uint8Array }[] | never[], abi: Abi) =>
	(logs as { 0: Uint8Array; 1: Uint8Array[]; 2: Uint8Array }[]).flatMap((l) => {
		try {
			return [
				decodeEventLog({
					abi,
					data: bytesToHex(l[2]),
					topics: l[1].map((t) => bytesToHex(t)) as [Hex, ...Hex[]]
				})
			];
		} catch {
			return [];
		}
	});

describe('PortunusSettlement in a JS EVM', () => {
	let c: Chain;
	beforeEach(async () => {
		c = await Chain.create();
	});

	it('immutables are set from the constructor', async () => {
		const get = async (fn: string) =>
			BigInt((await c.ok(STRANGER, c.settlement, settlementAbi as Abi, fn)).data);
		expect(await get('depositsAccount')).toBe(BigInt(DEPOSITS));
		expect(await get('charges')).toBe(BigInt(CHARGES));
		expect(await get('operator')).toBe(BigInt(OPERATOR));
		expect(await get('resolver')).toBe(BigInt(RESOLVER));
		expect(await get('token')).toBe(BigInt(TOKEN));
		expect(await get('maxHold')).toBe(MAX_HOLD);
	});

	it('idOf is keccak256(receipt)', async () => {
		const receipt = await c.hold({ amount: 5n * U });
		const r = await c.ok(STRANGER, c.settlement, settlementAbi as Abi, 'idOf', [receipt]);
		expect(r.data).toBe(keccak256(receipt));
	});

	it('settle: charge to the line, remainder to the payer, memos carried, status Settled', async () => {
		const receipt = await c.hold({ amount: 1200n * U });
		const r = await c.settle(OPERATOR, receipt, 300n * U, 0n, '0xc0', '0xe0');
		expect(r.ok).toBe(true);
		expect(await c.balance(TOKEN, CHARGES)).toBe(300n * U);
		expect(await c.balance(TOKEN, IMPORTER)).toBe(900n * U);
		expect(await c.balance(TOKEN, c.settlement)).toBe(0n);
		expect(await c.status(receipt)).toBe(1);
		const ev = events(
			r.logs as never,
			[
				...parseAbi([
					'event TransferWithMemo(address indexed from, address indexed to, uint256 amount, bytes32 indexed memo)'
				]),
				...(settlementAbi as Abi)
			] as Abi
		);
		const memos = ev
			.filter((e) => e.eventName === 'TransferWithMemo')
			.map((e) => (e.args as unknown as { memo: Hex }).memo);
		expect(memos).toContain(pad('0xc0'));
		expect(memos).toContain(pad('0xe0'));
		const settled = ev.find((e) => e.eventName === 'Settled')!.args as unknown as Record<
			string,
			unknown
		>;
		expect(settled.charged).toBe(300n * U);
		expect(settled.refunded).toBe(900n * U);
		expect(settled.disputedHeld).toBe(0n);
	});

	it('settle skips zero-amount legs (zero charge, and full charge)', async () => {
		const a = await c.hold({ amount: 100n * U });
		expect((await c.settle(OPERATOR, a, 0n, 0n)).ok).toBe(true); // all refund, no charge leg
		expect(await c.balance(TOKEN, CHARGES)).toBe(0n);
		expect(await c.balance(TOKEN, IMPORTER)).toBe(100n * U);
		const b = await c.hold({ amount: 80n * U });
		expect((await c.settle(OPERATOR, b, 80n * U, 0n)).ok).toBe(true); // all charge, no refund leg
		expect(await c.balance(TOKEN, CHARGES)).toBe(80n * U);
		expect(await c.balance(TOKEN, IMPORTER)).toBe(100n * U);
	});

	it('settles only once per receipt', async () => {
		const receipt = await c.hold({ amount: 50n * U });
		expect((await c.settle(OPERATOR, receipt, 10n * U, 0n)).ok).toBe(true);
		const again = await c.settle(OPERATOR, receipt, 10n * U, 0n);
		expect(again).toMatchObject({ ok: false, error: 'AlreadyHandled' });
		expect(await c.balance(TOKEN, CHARGES)).toBe(10n * U);
	});

	it('refuses charge + disputed above the deposit', async () => {
		const receipt = await c.hold({ amount: 100n * U });
		expect(await c.settle(OPERATOR, receipt, 101n * U, 0n)).toMatchObject({
			ok: false,
			error: 'ExceedsDeposit'
		});
		expect(await c.settle(OPERATOR, receipt, 60n * U, 41n * U)).toMatchObject({
			ok: false,
			error: 'ExceedsDeposit'
		});
		expect(await c.status(receipt)).toBe(0);
	});

	it('only the operator or the line (charges) may settle', async () => {
		const receipt = await c.hold({ amount: 10n * U });
		expect(await c.settle(STRANGER, receipt, 0n, 0n)).toMatchObject({
			ok: false,
			error: 'NotAuthorized'
		});
		expect(await c.settle(IMPORTER, receipt, 0n, 0n)).toMatchObject({
			ok: false,
			error: 'NotAuthorized'
		});
		expect(await c.settle(RESOLVER, receipt, 0n, 0n)).toMatchObject({
			ok: false,
			error: 'NotAuthorized'
		});
		expect((await c.settle(CHARGES, receipt, 0n, 0n)).ok).toBe(true);
	});

	it('receipt checks: length, recovery authority, recipient, token', async () => {
		const padded = await c.hold({ amount: 10n * U, extraBytes: true });
		expect(await c.settle(OPERATOR, padded, 0n, 0n)).toMatchObject({
			ok: false,
			error: 'BadReceipt'
		});

		const foreignAuthority = await c.hold({ amount: 10n * U, authority: STRANGER });
		expect(await c.settle(OPERATOR, foreignAuthority, 0n, 0n)).toMatchObject({
			ok: false,
			error: 'NotOurReceipt'
		});

		const otherAccount = await c.hold({ amount: 10n * U, recipient: STRANGER });
		expect(await c.settle(OPERATOR, otherAccount, 0n, 0n)).toMatchObject({
			ok: false,
			error: 'NotForAccount'
		});

		const wrongToken = await c.hold({ amount: 10n * U, token: WRONG_TOKEN });
		expect(await c.settle(OPERATOR, wrongToken, 0n, 0n)).toMatchObject({
			ok: false,
			error: 'WrongToken'
		});
	});

	it('accepts a per-container virtual address that resolves to the deposits account', async () => {
		const virtual = VirtualAddress.from({ masterId: '0x82bfcada', userTag: 1042n }) as Hex;
		const receipt = await c.hold({ amount: 25n * U, recipient: virtual });
		// Unregistered: the registry resolves it to itself, which is not our deposits account.
		expect(await c.settle(OPERATOR, receipt, 0n, 0n)).toMatchObject({
			ok: false,
			error: 'NotForAccount'
		});
		await c.ok(STRANGER, REGISTRY, registryAbi, 'setMaster', [virtual, DEPOSITS]);
		expect((await c.settle(OPERATOR, receipt, 5n * U, 0n)).ok).toBe(true);
		expect(await c.balance(TOKEN, IMPORTER)).toBe(20n * U);
	});

	it('dispute: undisputed part settles, disputed part stays in escrow, resolver decides once', async () => {
		const receipt = await c.hold({ amount: 1000n * U });
		const r = await c.settle(OPERATOR, receipt, 200n * U, 400n * U);
		expect(r.ok).toBe(true);
		expect(await c.status(receipt)).toBe(2); // Disputed
		expect(await c.balance(TOKEN, CHARGES)).toBe(200n * U);
		expect(await c.balance(TOKEN, IMPORTER)).toBe(400n * U); // 1000 - 200 - 400
		expect(await c.balance(TOKEN, c.settlement)).toBe(400n * U); // escrow

		const resolve = (from: string, toLine: bigint) =>
			c.call(from, c.settlement, settlementAbi as Abi, 'resolveDispute', [
				receipt,
				toLine,
				pad('0xdd')
			]);
		expect(await resolve(OPERATOR, 100n * U)).toMatchObject({ ok: false, error: 'NotAuthorized' });
		expect(await resolve(RESOLVER, 401n * U)).toMatchObject({ ok: false, error: 'ExceedsDeposit' });
		const ok = await resolve(RESOLVER, 150n * U);
		expect(ok.ok).toBe(true);
		expect(await c.balance(TOKEN, CHARGES)).toBe(350n * U);
		expect(await c.balance(TOKEN, IMPORTER)).toBe(650n * U);
		expect(await c.balance(TOKEN, c.settlement)).toBe(0n);
		expect(await c.status(receipt)).toBe(1); // Settled
		expect(await resolve(RESOLVER, 0n)).toMatchObject({ ok: false, error: 'NotDisputed' });
	});

	it('resolveDispute refuses receipts that were never disputed', async () => {
		const receipt = await c.hold({ amount: 10n * U });
		const r = await c.call(RESOLVER, c.settlement, settlementAbi as Abi, 'resolveDispute', [
			receipt,
			0n,
			pad('0x01')
		]);
		expect(r).toMatchObject({ ok: false, error: 'NotDisputed' });
	});

	it('returnToSender sends the whole receipt back, in any token, exactly once', async () => {
		const wrong = await c.hold({ amount: 77n * U, token: WRONG_TOKEN });
		const call = (from: string, receipt: Hex) =>
			c.call(from, c.settlement, settlementAbi as Abi, 'returnToSender', [receipt]);
		expect(await call(STRANGER, wrong)).toMatchObject({ ok: false, error: 'NotAuthorized' });
		expect((await call(OPERATOR, wrong)).ok).toBe(true);
		expect(await c.balance(WRONG_TOKEN, IMPORTER)).toBe(77n * U);
		expect(await c.status(wrong)).toBe(3); // Returned
		expect(await call(OPERATOR, wrong)).toMatchObject({ ok: false, error: 'AlreadyHandled' });
		const unknownSender = await c.hold({ amount: 5n * U, originator: STRANGER });
		expect((await call(CHARGES, unknownSender)).ok).toBe(true);
		expect(await c.balance(TOKEN, STRANGER)).toBe(5n * U);
		// A returned receipt cannot be settled afterwards.
		expect(await c.settle(OPERATOR, unknownSender, 0n, 0n)).toMatchObject({
			ok: false,
			error: 'AlreadyHandled'
		});
	});

	it('refundAfterDeadline: anyone, only after maxHold, full refund', async () => {
		const blockedAt = c.timestamp;
		const receipt = await c.hold({ amount: 300n * U, blockedAt });
		const call = () =>
			c.call(STRANGER, c.settlement, settlementAbi as Abi, 'refundAfterDeadline', [receipt]);
		expect(await call()).toMatchObject({ ok: false, error: 'TooEarly' });
		c.timestamp = blockedAt + MAX_HOLD - 1n;
		expect(await call()).toMatchObject({ ok: false, error: 'TooEarly' });
		c.timestamp = blockedAt + MAX_HOLD;
		expect((await call()).ok).toBe(true);
		expect(await c.balance(TOKEN, IMPORTER)).toBe(300n * U);
		expect(await c.status(receipt)).toBe(3);
		expect(await call()).toMatchObject({ ok: false, error: 'AlreadyHandled' });
		// Settled receipts cannot be refunded again.
		const settled = await c.hold({ amount: 10n * U, blockedAt });
		await c.settle(OPERATOR, settled, 0n, 0n);
		expect(
			await c.call(STRANGER, c.settlement, settlementAbi as Abi, 'refundAfterDeadline', [settled])
		).toMatchObject({ ok: false, error: 'AlreadyHandled' });
	});

	it('settleMany settles every receipt atomically', async () => {
		const a = await c.hold({ amount: 1200n * U });
		const b = await c.hold({ amount: 2000n * U, originator: STRANGER });
		const many = (from: string, receipts: Hex[], charges: bigint[], disputed: bigint[]) =>
			c.call(from, c.settlement, settlementAbi as Abi, 'settleMany', [
				receipts,
				charges,
				disputed,
				receipts.map(() => pad('0xc0')),
				receipts.map(() => pad('0xe0'))
			]);
		// Second item invalid (charge above deposit): nothing is settled.
		expect(await many(OPERATOR, [a, b], [100n * U, 3000n * U], [0n, 0n])).toMatchObject({
			ok: false,
			error: 'ExceedsDeposit'
		});
		expect(await c.status(a)).toBe(0);
		expect(await c.balance(TOKEN, CHARGES)).toBe(0n);
		// Length mismatch.
		expect(await many(OPERATOR, [a, b], [1n], [0n, 0n])).toMatchObject({
			ok: false,
			error: 'LengthMismatch'
		});
		// Authorization.
		expect(await many(STRANGER, [a], [0n], [0n])).toMatchObject({
			ok: false,
			error: 'NotAuthorized'
		});
		// Success.
		expect((await many(OPERATOR, [a, b], [100n * U, 500n * U], [0n, 0n])).ok).toBe(true);
		expect(await c.balance(TOKEN, CHARGES)).toBe(600n * U);
		expect(await c.balance(TOKEN, IMPORTER)).toBe(1100n * U);
		expect(await c.balance(TOKEN, STRANGER)).toBe(1500n * U);
		expect(await c.status(a)).toBe(1);
		expect(await c.status(b)).toBe(1);
	});

	it('constructor rejects zero addresses and a zero hold period', async () => {
		const evm = await createEVM();
		const zero = '0x0000000000000000000000000000000000000000';
		const deploy = (args: unknown[]) =>
			evm.runCall({
				caller: addr(OPERATOR),
				data: hexToBytes(
					encodeDeployData({ abi: settlementAbi, bytecode: settlementBytecode, args } as never)
				),
				gasLimit: 30_000_000n
			});
		expect(
			(await deploy([zero, CHARGES, OPERATOR, RESOLVER, TOKEN, MAX_HOLD])).execResult.exceptionError
		).toBeDefined();
		expect(
			(await deploy([DEPOSITS, CHARGES, OPERATOR, RESOLVER, TOKEN, 0n])).execResult.exceptionError
		).toBeDefined();
		expect(
			(await deploy([DEPOSITS, CHARGES, OPERATOR, RESOLVER, TOKEN, MAX_HOLD])).execResult
				.exceptionError
		).toBeUndefined();
	});
});

void encodeAbiParameters;
