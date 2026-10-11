import { describe, expect, it } from 'vitest';
import {
  addUnits,
  allocateCharge,
  accrued,
  assertTransition,
  canTransition,
  checkContainerNumber,
  chargeMemo,
  computeCheckDigit,
  CONTAINER_STATES,
  DAY_MS,
  decodeMemo,
  depositAddressFor,
  depositFreeExpiry,
  depositMemo,
  detentionDaysAt,
  disputeSplit,
  encodeMemo,
  formatContainerNumber,
  formatUsd,
  freeTimeEndsAt,
  fromUnits,
  generateContainerNumber,
  heldReturnMemo,
  isVirtualAddress,
  maxCharge,
  minUnits,
  parseMemo,
  parseVirtualAddress,
  pullMemo,
  refundMemo,
  settlementAmounts,
  settlementWindowEnd,
  silentLineEligible,
  SIM_MASTER_ID,
  simMasterIdForIndex,
  subUnits,
  suggestedMode,
  toUnits,
  userTagFor,
  validateContainerNumber,
  ALLOWED_TRANSITIONS
} from './index';

describe('money', () => {
  it('converts between decimals and 6-decimal base units', () => {
    expect(toUnits('1200.50')).toBe(1200_500_000n);
    expect(toUnits('0.000001')).toBe(1n);
    expect(toUnits(45)).toBe(45_000_000n);
    expect(toUnits('1,200.50')).toBe(1200_500_000n);
    expect(toUnits('-2.5')).toBe(-2_500_000n);
    expect(() => toUnits('1.0000001')).toThrow();
    expect(() => toUnits('abc')).toThrow();
    expect(fromUnits(1200_500_000n)).toBe('1200.50');
    expect(fromUnits('1234567')).toBe('1.234567');
    expect(fromUnits(0n)).toBe('0.00');
    expect(fromUnits(-1_500_000n)).toBe('-1.50');
  });
  it('formats USD', () => {
    expect(formatUsd('1200500000')).toBe('$1,200.50');
    expect(formatUsd(toUnits('3500'))).toBe('$3,500.00');
    expect(formatUsd(1234567n)).toBe('$1.23');
    expect(formatUsd(995_000n)).toBe('$1.00'); // rounds half up to cents
    expect(formatUsd(toUnits('1234567.89'), { symbol: false })).toBe('1,234,567.89');
    expect(formatUsd(-toUnits('5'))).toBe('-$5.00');
  });
  it('adds, subtracts and takes the minimum on unit strings', () => {
    expect(addUnits('100', '250')).toBe('350');
    expect(subUnits('100', '250')).toBe('-150');
    expect(minUnits('100', 250n)).toBe('100');
  });
});

describe('ISO 6346 container numbers', () => {
  it('validates real numbers and rejects bad check digits', () => {
    expect(validateContainerNumber('CSQU3054383')).toBe(true);
    expect(validateContainerNumber('csqu 305438 3')).toBe(true);
    expect(validateContainerNumber('CSQU3054384')).toBe(false);
    expect(validateContainerNumber('CSQX3054383')).toBe(false); // category must be U, J or Z
    expect(validateContainerNumber('CSQU305438')).toBe(false);
    expect(computeCheckDigit('CSQU305438')).toBe(3);
    const bad = checkContainerNumber('CSQU3054384');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toMatch(/Check digit should be 3/);
  });
  it('generates valid numbers for seeds, including the remainder-10 case', () => {
    for (let s = 0; s < 400; s++) expect(validateContainerNumber(generateContainerNumber('MRDU', 100000 + s))).toBe(true);
    expect(formatContainerNumber('MRDU1234565')).toBe('MRDU 123456 5');
  });
});

describe('memos', () => {
  it('follow the grammar, fit in 32 bytes and round trip', () => {
    const bl = 'MEDU123456789012345678'; // longer than 17 chars: only the tail is kept
    const texts = [
      depositMemo('MSCU1234567', bl),
      pullMemo('MSCU1234567', 3, bl),
      chargeMemo('MSCU1234567', 'EIR-778812'),
      refundMemo('MSCU1234567', 'EIR-778812'),
      heldReturnMemo('0x3f9a77c1d2e4b5a6978877665544332211')
    ];
    expect(texts[0]).toBe(`PD MSCU1234567 ${bl.slice(-17)}`);
    expect(texts[1]).toBe(`PC MSCU1234567 D03 ${bl.slice(-12)}`);
    expect(texts[2]).toBe('PS MSCU1234567 EIR-778812');
    expect(texts[3]).toBe('PR MSCU1234567 EIR-778812');
    expect(texts[4]).toBe('PX 3f9a77c1d2e4b5a6');
    for (const t of texts) {
      expect(new TextEncoder().encode(t).length).toBeLessThanOrEqual(32);
      const hex = encodeMemo(t);
      expect(hex).toHaveLength(2 + 64);
      expect(decodeMemo(hex)).toBe(t);
    }
    expect(() => encodeMemo('x'.repeat(33))).toThrow(/32 bytes/);
    expect(parseMemo(texts[1])).toMatchObject({ kind: 'pull', container: 'MSCU1234567', day: 3 });
    expect(parseMemo(texts[2])).toMatchObject({ kind: 'charge', reference: 'EIR-778812' });
    expect(parseMemo('hello').kind).toBeNull();
  });
});

describe('state machine', () => {
  it('allows the documented path and nothing else', () => {
    const path = ['awaiting_deposit', 'deposit_held', 'released', 'in_free_time', 'in_detention', 'returned', 'settling', 'settled'] as const;
    for (let i = 0; i < path.length - 1; i++) expect(canTransition(path[i], path[i + 1])).toBe(true);
    expect(canTransition('requested', 'authorized')).toBe(true);
    expect(canTransition('authorized', 'released')).toBe(true);
    expect(canTransition('settling', 'disputed')).toBe(true);
    expect(canTransition('disputed', 'settled')).toBe(true);
    expect(() => assertTransition('awaiting_deposit', 'released')).toThrow(/Illegal container transition/);
    expect(() => assertTransition('settled', 'returned')).toThrow();
    expect(() => assertTransition('in_free_time', 'settled')).toThrow();
    expect(ALLOWED_TRANSITIONS.settled).toEqual([]);
    expect(CONTAINER_STATES).toHaveLength(11);
  });
});

describe('settlement rules', () => {
  const F = freeTimeEndsAt(0, 7);
  it('free time ends releasedAt + freeDays', () => expect(F).toBe(7 * DAY_MS));

  it('charges detention per started day after free time, capped at maxDetentionDays', () => {
    const c = { freeTimeEndsAt: F, maxDetentionDays: 30 };
    expect(detentionDaysAt(c, F)).toBe(0);
    expect(detentionDaysAt(c, F + 1)).toBe(1);
    expect(detentionDaysAt(c, F + DAY_MS - 1)).toBe(1);
    expect(detentionDaysAt(c, F + DAY_MS)).toBe(2);
    expect(detentionDaysAt(c, F + 2 * DAY_MS + 3_600_000)).toBe(3);
    expect(detentionDaysAt(c, F + 100 * DAY_MS)).toBe(30);
    expect(detentionDaysAt(c, 0)).toBe(0);
    // counting stops at the return
    expect(detentionDaysAt({ ...c, returnedAt: F + 1.5 * DAY_MS }, F + 20 * DAY_MS)).toBe(2);
    expect(detentionDaysAt({ ...c, returnedAt: F - DAY_MS }, F + 20 * DAY_MS)).toBe(0);
  });

  it('accrues days x rate, capped at the deposit', () => {
    const rate = toUnits('75');
    const deposit = toUnits('2000');
    expect(accrued({ days: 3, dailyRateUnits: rate, depositUnits: deposit })).toBe(toUnits('225'));
    expect(accrued({ days: 100, dailyRateUnits: rate, depositUnits: deposit })).toBe(deposit);
    expect(accrued({ days: 0, dailyRateUnits: rate, depositUnits: deposit })).toBe(0n);
  });

  it('max charge = min(deposit, accrued + damage); refund = held - charge (+ overpayment)', () => {
    const deposit = toUnits('1200');
    expect(maxCharge({ depositUnits: deposit, accruedUnits: toUnits('135'), damageUnits: toUnits('100') })).toBe(toUnits('235'));
    expect(maxCharge({ depositUnits: deposit, accruedUnits: toUnits('1200'), damageUnits: toUnits('500') })).toBe(deposit);
    const a = settlementAmounts({ heldUnits: deposit, depositUnits: deposit, accruedUnits: toUnits('135'), damageUnits: toUnits('100') });
    expect([a.chargeUnits, a.refundUnits, a.overpaymentUnits]).toEqual([toUnits('235'), toUnits('965'), 0n]);
    const over = settlementAmounts({ heldUnits: toUnits('1500'), depositUnits: deposit, accruedUnits: toUnits('135') });
    expect([over.chargeUnits, over.refundUnits, over.overpaymentUnits]).toEqual([toUnits('135'), toUnits('1365'), toUnits('300')]);
    // a short deposit can never be charged more than it holds
    const short = settlementAmounts({ heldUnits: toUnits('100'), depositUnits: deposit, accruedUnits: toUnits('900') });
    expect([short.chargeUnits, short.refundUnits]).toEqual([toUnits('100'), 0n]);
    // dispute keeps only the disputed part back from the line
    const d = settlementAmounts({ heldUnits: deposit, depositUnits: deposit, accruedUnits: toUnits('300'), disputedUnits: toUnits('100') });
    expect([d.chargeUnits, d.toLineNowUnits, d.escrowUnits, d.refundUnits]).toEqual([toUnits('300'), toUnits('200'), toUnits('100'), toUnits('900')]);
    expect(() => settlementAmounts({ heldUnits: deposit, depositUnits: deposit, accruedUnits: toUnits('50'), disputedUnits: toUnits('60') })).toThrow();
  });

  it('spreads a charge across several deposit receipts', () => {
    const r = allocateCharge([toUnits('700'), toUnits('500')], toUnits('800'), toUnits('150'));
    expect(r.map((x) => [x.charge, x.disputed, x.refund])).toEqual([
      [toUnits('700'), toUnits('150'), 0n],
      [toUnits('100'), 0n, toUnits('400')]
    ]);
  });

  it('splits disputes between the line and the importer', () => {
    expect(disputeSplit({ disputedUnits: toUnits('50'), toLineUnits: toUnits('20') })).toEqual({ toLine: toUnits('20'), toImporter: toUnits('30') });
    expect(() => disputeSplit({ disputedUnits: toUnits('50'), toLineUnits: toUnits('51') })).toThrow();
    expect(() => disputeSplit({ disputedUnits: toUnits('50'), toLineUnits: -1n })).toThrow();
  });

  it('window end, deposit-free expiry and suggested mode', () => {
    expect(settlementWindowEnd(1000)).toBe(1000 + 3 * DAY_MS);
    expect(settlementWindowEnd(1000, 15)).toBe(1000 + 15 * DAY_MS);
    expect(depositFreeExpiry(F)).toBe(F + 30 * DAY_MS);
    expect(depositFreeExpiry(F, 45)).toBe(F + 45 * DAY_MS);
    expect(suggestedMode({ cleanReturns: 2, openDisputes: 0 })).toBe('held');
    expect(suggestedMode({ cleanReturns: 3, openDisputes: 0 })).toBe('depositFree');
    expect(suggestedMode({ cleanReturns: 6, openDisputes: 1 })).toBe('held');
    expect(suggestedMode({ cleanReturns: 5, openDisputes: 0, cleanReturnsForDepositFree: 6 })).toBe('held');
  });

  it('silent-line eligibility', () => {
    const base = { state: 'in_detention' as const, hasReturnReceipt: false, releasedAt: 0, returnDate: 10 * DAY_MS, now: 12 * DAY_MS };
    expect(silentLineEligible(base)).toEqual({ ok: true });
    expect(silentLineEligible({ ...base, now: 10 * DAY_MS + 3_600_000 }).ok).toBe(false); // line still has time
    expect(silentLineEligible({ ...base, hasReturnReceipt: true }).ok).toBe(false);
    expect(silentLineEligible({ ...base, state: 'settled' }).ok).toBe(false);
    expect(silentLineEligible({ ...base, returnDate: -1 }).ok).toBe(false);
    expect(silentLineEligible({ ...base, returnDate: 13 * DAY_MS }).ok).toBe(false);
    expect(silentLineEligible({ ...base, graceHours: 0, now: 10 * DAY_MS + 1 }).ok).toBe(true);
  });
});

describe('virtual addresses', () => {
  it('derive one address per container from the line master id and a per-line sequence', () => {
    const a = depositAddressFor({ masterId: SIM_MASTER_ID, seq: 1 });
    const b = depositAddressFor({ masterId: SIM_MASTER_ID, seq: 2 });
    expect(a).not.toBe(b);
    expect(a).toBe('0x5133d000fdfdfdfdfdfdfdfdfdfd5a1700000001');
    expect(isVirtualAddress(a)).toBe(true);
    expect(isVirtualAddress('0x0000000000000000000000000000000000000001')).toBe(false);
    expect(parseVirtualAddress(a)).toEqual({ masterId: SIM_MASTER_ID, userTag: '0x5a1700000001' });
    expect(parseVirtualAddress('0x0000000000000000000000000000000000000001')).toBeNull();
    expect(userTagFor(0x5a17, 0xffffffff)).toBe('0x5a17ffffffff');
    expect(simMasterIdForIndex(1)).toBe('0x5133d001');
    expect(depositAddressFor({ masterId: simMasterIdForIndex(1), seq: 1 })).not.toBe(a);
  });
});
