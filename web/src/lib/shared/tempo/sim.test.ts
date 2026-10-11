import { describe, expect, it } from 'vitest';
import { ChainError, SpendingLimitExceededError } from './adapter';
import {
	SimChain,
	simTxHash,
	type SimKey,
	type SimMaster,
	type SimMeta,
	type SimReceipt,
	type SimStore,
	type SimEvent
} from './sim';
import { encodeMemo } from '../domain/memo';
import { ALPHA_USD, BETA_USD, DAY_MS } from '../domain/constants';
import { depositAddressFor, SIM_MASTER_ID } from '../domain/virtualAddress';
import { toUnits } from '../domain/money';

const lc = (s: string) => s.toLowerCase();

class MemoryStore implements SimStore {
	meta: SimMeta = { seq: 0, block: 100, blockedNonce: 0, clockOffsetMs: 0, envPrefix: 0x5a17 };
	balances = new Map<string, bigint>();
	masters: SimMaster[] = [];
	keys = new Map<string, SimKey>();
	receipts = new Map<string, SimReceipt>();
	events: SimEvent[] = [];
	async getMeta() {
		return { ...this.meta };
	}
	async setMeta(m: SimMeta) {
		this.meta = { ...m };
	}
	async getBalance(a: string, t: string) {
		return this.balances.get(`${lc(a)}|${lc(t)}`) ?? 0n;
	}
	async setBalance(a: string, t: string, v: bigint) {
		this.balances.set(`${lc(a)}|${lc(t)}`, v);
	}
	async findMasterForAddress(address: string) {
		const a = lc(address);
		return (
			this.masters.find(
				(m) =>
					m.account === a ||
					(a.startsWith(m.masterId) && a.slice(10, 30) === 'fdfdfdfdfdfdfdfdfdfd')
			) ?? null
		);
	}
	async getKey(account: string, keyId: string) {
		return this.keys.get(`${lc(account)}|${lc(keyId)}`) ?? null;
	}
	async putKey(k: SimKey) {
		this.keys.set(`${k.account}|${k.keyId}`, { ...k });
	}
	async getReceipt(id: string) {
		return this.receipts.get(id) ?? null;
	}
	async putReceipt(r: SimReceipt) {
		this.receipts.set(r.id, { ...r });
	}
	async addEvent(e: SimEvent) {
		this.events.push(e);
	}
}

const LINE = {
	masterId: SIM_MASTER_ID,
	account: '0x00000000000000000000000000000000000d0001',
	settlement: '0x00000000000000000000000000000000000500e1',
	charges: '0x00000000000000000000000000000000000c0001',
	resolver: '0x0000000000000000000000000000000000000e50',
	token: ALPHA_USD
};
const PAYER = '0x00000000000000000000000000000000000a0001';
const KEY = '0x00000000000000000000000000000000000b0001';
const memo = encodeMemo('PD MRDU1234565 BL1');

function setup(now = 1_000_000) {
	const store = new MemoryStore();
	store.masters.push({ ...LINE });
	const clock = { now };
	const chain = new SimChain(store, () => clock.now);
	return { store, chain, clock };
}

describe('sim chain: transfers and the guard', () => {
	it('routes any transfer to the deposits account or a virtual address into a receipt, never a balance', async () => {
		const { store, chain } = setup();
		await chain.fund(PAYER, ALPHA_USD, toUnits('5000'));
		const va = depositAddressFor({ masterId: SIM_MASTER_ID, seq: 7 });
		const r = await chain.transferBatch({
			from: PAYER,
			token: ALPHA_USD,
			calls: [
				{ to: va, amount: toUnits('1200'), memo },
				{ to: LINE.account, amount: toUnits('100') }
			]
		});
		expect(r.held).toHaveLength(2);
		expect(await chain.balanceOf(LINE.account, ALPHA_USD)).toBe(0n);
		expect(await chain.balanceOf(va, ALPHA_USD)).toBe(0n);
		expect(await chain.balanceOf(PAYER, ALPHA_USD)).toBe(toUnits('3700'));
		expect(r.held[0]).toMatchObject({
			recipient: va,
			blockedReason: 'receivePolicy',
			amount: toUnits('1200').toString(),
			memo
		});
		expect(r.held[0].receipt.length).toBe(2 + 320 * 2);
		expect(store.events.map((e) => e.name)).toContain('TransferBlocked');
		// plain destinations are credited normally
		const plain = '0x00000000000000000000000000000000000f0001';
		await chain.transferBatch({
			from: PAYER,
			token: ALPHA_USD,
			calls: [{ to: plain, amount: toUnits('10') }]
		});
		expect(await chain.balanceOf(plain, ALPHA_USD)).toBe(toUnits('10'));
	});

	it('batches are all-or-nothing', async () => {
		const { store, chain } = setup();
		await chain.fund(PAYER, ALPHA_USD, toUnits('1000'));
		const va = depositAddressFor({ masterId: SIM_MASTER_ID, seq: 1 });
		const seqBefore = store.meta.seq;
		await expect(
			chain.transferBatch({
				from: PAYER,
				token: ALPHA_USD,
				calls: [
					{ to: va, amount: toUnits('600') },
					{ to: va, amount: toUnits('600') }
				]
			})
		).rejects.toMatchObject({ chain: 'InsufficientBalance' });
		expect(await chain.balanceOf(PAYER, ALPHA_USD)).toBe(toUnits('1000'));
		expect(store.receipts.size).toBe(0);
		expect(store.meta.seq).toBe(seqBefore);
		await expect(
			chain.transferBatch({ from: PAYER, token: ALPHA_USD, calls: [{ to: va, amount: 0n }] })
		).rejects.toBeInstanceOf(ChainError);
	});

	it('tx hashes are deterministic and the block counter advances once per transaction', async () => {
		const a = setup();
		const b = setup();
		for (const s of [a, b]) {
			await s.chain.fund(PAYER, ALPHA_USD, toUnits('100'));
		}
		const va = depositAddressFor({ masterId: SIM_MASTER_ID, seq: 1 });
		const ra = await a.chain.transferBatch({
			from: PAYER,
			token: ALPHA_USD,
			calls: [{ to: va, amount: toUnits('5'), memo }]
		});
		const rb = await b.chain.transferBatch({
			from: PAYER,
			token: ALPHA_USD,
			calls: [{ to: va, amount: toUnits('5'), memo }]
		});
		expect(ra.tx.txHash).toBe(rb.tx.txHash);
		expect(ra.tx.txHash).toBe(
			simTxHash(1, 'transferBatch', {
				from: PAYER.toLowerCase(),
				token: ALPHA_USD,
				calls: [{ to: va, amount: toUnits('5'), memo }]
			})
		);
		const rc = await a.chain.transferBatch({
			from: PAYER,
			token: ALPHA_USD,
			calls: [{ to: va, amount: toUnits('5'), memo }]
		});
		expect(rc.tx.blockNumber).toBe(ra.tx.blockNumber + 1);
		expect(rc.tx.txHash).not.toBe(ra.tx.txHash);
		expect(ra.tx.finalityMs).toBe(450 + (1 % 100));
	});
});

describe('sim chain: access keys', () => {
	async function withKey(opts: { limit?: bigint; expiry?: number } = {}) {
		const s = setup(10_000);
		await s.chain.fund(PAYER, ALPHA_USD, toUnits('10000'));
		await s.chain.authorizeKey({
			account: PAYER,
			keyId: KEY,
			token: ALPHA_USD,
			limit: opts.limit ?? toUnits('45'),
			periodSec: 86_400,
			recipients: [LINE.charges],
			expiry: opts.expiry ?? 10_000 + 40 * DAY_MS
		});
		return s;
	}
	const pull = (
		s: Awaited<ReturnType<typeof withKey>>,
		amount = toUnits('45'),
		to = LINE.charges
	) =>
		s.chain.pull({
			account: PAYER,
			keyId: KEY,
			token: ALPHA_USD,
			to,
			amount,
			memo: encodeMemo('PC MRDU1234565 D01 BL1')
		});

	it('allows one day of detention per period and REFUSES the second pull without recording a transaction', async () => {
		const s = await withKey();
		const r1 = await pull(s);
		expect(r1.remainingUnits).toBe('0');
		expect(await s.chain.balanceOf(LINE.charges, ALPHA_USD)).toBe(toUnits('45'));
		const seq = s.store.meta.seq;
		const events = s.store.events.length;
		let err: unknown;
		await pull(s).catch((e) => (err = e));
		expect(err).toBeInstanceOf(SpendingLimitExceededError);
		expect((err as SpendingLimitExceededError).remaining).toBe(0n);
		expect((err as SpendingLimitExceededError).periodEnd).toBe(10_000 + DAY_MS);
		expect(s.store.meta.seq).toBe(seq);
		expect(s.store.events.length).toBe(events);
		expect(await s.chain.balanceOf(LINE.charges, ALPHA_USD)).toBe(toUnits('45'));
		// partial pulls count against the same period
		const s2 = await withKey();
		await pull(s2, toUnits('20'));
		await expect(pull(s2, toUnits('30'))).rejects.toBeInstanceOf(SpendingLimitExceededError);
		await pull(s2, toUnits('25'));
	});

	it('rolls over on the product clock, anchored at the authorization time', async () => {
		const s = await withKey();
		await pull(s);
		s.clock.now = 10_000 + DAY_MS - 1;
		await expect(pull(s)).rejects.toBeInstanceOf(SpendingLimitExceededError);
		s.clock.now = 10_000 + DAY_MS;
		await pull(s);
		// several missed days do not accumulate: still one day's worth
		s.clock.now = 10_000 + 6 * DAY_MS + 5;
		await pull(s);
		await expect(pull(s)).rejects.toBeInstanceOf(SpendingLimitExceededError);
		const st = await s.chain.keyState({ account: PAYER, keyId: KEY });
		expect(st.periodEnd).toBe(10_000 + 7 * DAY_MS);
		expect(st.remainingUnits).toBe('0');
	});

	it('enforces recipient scope, expiry and revocation (forever)', async () => {
		const s = await withKey({ expiry: 10_000 + 3 * DAY_MS });
		await expect(
			pull(s, toUnits('10'), '0x00000000000000000000000000000000000f0009')
		).rejects.toMatchObject({ chain: 'CallNotAllowed' });
		s.clock.now = 10_000 + 3 * DAY_MS;
		await expect(pull(s)).rejects.toMatchObject({ chain: 'KeyExpired' });

		const r = await withKey();
		await r.chain.revokeKey({ account: PAYER, keyId: KEY });
		await expect(pull(r)).rejects.toMatchObject({ chain: 'KeyAlreadyRevoked' });
		await expect(r.chain.revokeKey({ account: PAYER, keyId: KEY })).rejects.toMatchObject({
			chain: 'KeyAlreadyRevoked'
		});
		// a revoked key id can never be authorized again
		await expect(
			r.chain.authorizeKey({
				account: PAYER,
				keyId: KEY,
				token: ALPHA_USD,
				limit: 1n,
				periodSec: 86_400,
				recipients: [LINE.charges],
				expiry: 99_999_999
			})
		).rejects.toMatchObject({ chain: 'KeyAlreadyRevoked' });
		// and an active key cannot be authorized twice
		const d = await withKey();
		await expect(
			d.chain.authorizeKey({
				account: PAYER,
				keyId: KEY,
				token: ALPHA_USD,
				limit: 1n,
				periodSec: 86_400,
				recipients: [LINE.charges],
				expiry: 99_999_999
			})
		).rejects.toMatchObject({ chain: 'KeyAlreadyExists' });
		await expect(
			d.chain.revokeKey({ account: PAYER, keyId: '0x0000000000000000000000000000000000009999' })
		).rejects.toMatchObject({ chain: 'KeyNotFound' });
	});

	it('fails when the importer cannot cover the pull', async () => {
		const s = setup(10_000);
		await s.chain.fund(PAYER, ALPHA_USD, toUnits('10'));
		await s.chain.authorizeKey({
			account: PAYER,
			keyId: KEY,
			token: ALPHA_USD,
			limit: toUnits('45'),
			periodSec: 86_400,
			recipients: [LINE.charges],
			expiry: 10_000 + DAY_MS * 5
		});
		await expect(pull(s as never)).rejects.toMatchObject({ chain: 'InsufficientBalance' });
		expect((await s.chain.keyState({ account: PAYER, keyId: KEY })).remainingUnits).toBe(
			toUnits('45').toString()
		);
	});
});

describe('sim chain: settlement contract', () => {
	async function held(amount = toUnits('2000')) {
		const s = setup();
		await s.chain.fund(PAYER, ALPHA_USD, toUnits('10000'));
		const va = depositAddressFor({ masterId: SIM_MASTER_ID, seq: 3 });
		const r = await s.chain.transferBatch({
			from: PAYER,
			token: ALPHA_USD,
			calls: [{ to: va, amount, memo }]
		});
		return { ...s, id: r.held[0].id, va };
	}
	const cm = encodeMemo('PS MRDU1234565 EIR-1');
	const rm = encodeMemo('PR MRDU1234565 EIR-1');

	it('pays charges to the line and the remainder to the payer, in one transaction, once', async () => {
		const s = await held();
		const r = await s.chain.settle({
			items: [
				{ receiptId: s.id, charge: toUnits('225'), disputed: 0n, chargeMemo: cm, refundMemo: rm }
			]
		});
		expect(r.legs.map((l) => [l.kind, l.to, l.amountUnits])).toEqual([
			['charge', LINE.charges, toUnits('225').toString()],
			['refund', PAYER.toLowerCase(), toUnits('1775').toString()]
		]);
		expect(await s.chain.balanceOf(LINE.charges, ALPHA_USD)).toBe(toUnits('225'));
		expect(await s.chain.balanceOf(PAYER, ALPHA_USD)).toBe(toUnits('10000') - toUnits('225'));
		expect(s.store.events.map((e) => e.name)).toEqual(
			expect.arrayContaining(['ReceiptClaimed', 'Settled'])
		);
		await expect(
			s.chain.settle({
				items: [{ receiptId: s.id, charge: 0n, disputed: 0n, chargeMemo: cm, refundMemo: rm }]
			})
		).rejects.toMatchObject({
			chain: 'ReceiptAlreadySettled'
		});
		expect(await s.chain.readGuardBalance(s.id)).toBe(0n);
	});

	it('rejects charge + disputed above the amount, unknown receipts and duplicates; nothing is applied', async () => {
		const s = await held(toUnits('100'));
		await expect(
			s.chain.settle({
				items: [
					{
						receiptId: s.id,
						charge: toUnits('60'),
						disputed: toUnits('50'),
						chargeMemo: cm,
						refundMemo: rm
					}
				]
			})
		).rejects.toMatchObject({ chain: 'ChargeExceedsAmount' });
		await expect(
			s.chain.settle({
				items: [{ receiptId: '0xdead', charge: 0n, disputed: 0n, chargeMemo: cm, refundMemo: rm }]
			})
		).rejects.toMatchObject({ chain: 'InvalidReceipt' });
		const twice = { receiptId: s.id, charge: 0n, disputed: 0n, chargeMemo: cm, refundMemo: rm };
		await expect(s.chain.settle({ items: [twice, twice] })).rejects.toMatchObject({
			chain: 'ReceiptAlreadySettled'
		});
		expect(await s.chain.readGuardBalance(s.id)).toBe(toUnits('100'));
		expect(await s.chain.balanceOf(LINE.charges, ALPHA_USD)).toBe(0n);
	});

	it('keeps the disputed amount in escrow until the resolver splits it, once', async () => {
		const s = await held(toUnits('2000'));
		const r = await s.chain.settle({
			items: [
				{
					receiptId: s.id,
					charge: toUnits('300'),
					disputed: toUnits('500'),
					chargeMemo: cm,
					refundMemo: rm
				}
			]
		});
		expect(r.results[0]).toMatchObject({
			chargedUnits: toUnits('300').toString(),
			refundedUnits: toUnits('1200').toString(),
			escrowUnits: toUnits('500').toString()
		});
		expect(s.store.receipts.get(s.id)!.status).toBe('disputed');
		await expect(
			s.chain.resolveDispute({ receiptId: s.id, toLine: toUnits('600'), memo: rm })
		).rejects.toMatchObject({ chain: 'ChargeExceedsAmount' });
		const d = await s.chain.resolveDispute({ receiptId: s.id, toLine: toUnits('200'), memo: rm });
		expect([d.toLineUnits, d.toPayerUnits]).toEqual([
			toUnits('200').toString(),
			toUnits('300').toString()
		]);
		expect(await s.chain.balanceOf(LINE.charges, ALPHA_USD)).toBe(toUnits('500'));
		expect(await s.chain.balanceOf(PAYER, ALPHA_USD)).toBe(toUnits('10000') - toUnits('500'));
		await expect(
			s.chain.resolveDispute({ receiptId: s.id, toLine: 0n, memo: rm })
		).rejects.toMatchObject({ chain: 'NotDisputed' });
	});

	it('settles a batch of receipts atomically (settleMany)', async () => {
		const s = setup();
		await s.chain.fund(PAYER, ALPHA_USD, toUnits('10000'));
		const a = await s.chain.transferBatch({
			from: PAYER,
			token: ALPHA_USD,
			calls: [1, 2, 3].map((n) => ({
				to: depositAddressFor({ masterId: SIM_MASTER_ID, seq: n }),
				amount: toUnits('1000'),
				memo
			}))
		});
		const items = a.held.map((h) => ({
			receiptId: h.id,
			charge: toUnits('100'),
			disputed: 0n,
			chargeMemo: cm,
			refundMemo: rm
		}));
		const bad = [...items.slice(0, 2), { ...items[2], charge: toUnits('5000') }];
		await expect(s.chain.settle({ items: bad })).rejects.toBeInstanceOf(ChainError);
		for (const h of a.held) expect(await s.chain.readGuardBalance(h.id)).toBe(toUnits('1000'));
		const r = await s.chain.settle({ items });
		expect(new Set(r.legs.map((l) => l.logIndex)).size).toBe(r.legs.length);
		expect(await s.chain.balanceOf(LINE.charges, ALPHA_USD)).toBe(toUnits('300'));
	});

	it('wrong tokens can only be returned to the sender, never settled', async () => {
		const s = setup();
		await s.chain.fund(PAYER, BETA_USD, toUnits('500'));
		const va = depositAddressFor({ masterId: SIM_MASTER_ID, seq: 1 });
		const r = await s.chain.transferBatch({
			from: PAYER,
			token: BETA_USD,
			calls: [{ to: va, amount: toUnits('250'), memo }]
		});
		const id = r.held[0].id;
		await expect(
			s.chain.settle({
				items: [{ receiptId: id, charge: 0n, disputed: 0n, chargeMemo: cm, refundMemo: rm }]
			})
		).rejects.toMatchObject({ chain: 'WrongToken' });
		const back = await s.chain.returnToSender({
			receiptId: id,
			memo: encodeMemo('PX 0123456789abcdef')
		});
		expect(back.legs[0]).toMatchObject({
			kind: 'held_return',
			to: PAYER.toLowerCase(),
			amountUnits: toUnits('250').toString()
		});
		expect(await s.chain.balanceOf(PAYER, BETA_USD)).toBe(toUnits('500'));
		await expect(s.chain.returnToSender({ receiptId: id, memo })).rejects.toMatchObject({
			chain: 'ReceiptAlreadySettled'
		});
	});
});
