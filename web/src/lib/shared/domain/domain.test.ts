import { describe, expect, it } from 'vitest';
import {
	computeCheckDigit,
	depositAddressFor,
	formatContainerNumber,
	formatUsd,
	fromUnits,
	generateContainerNumber,
	toUnits,
	validateContainerNumber,
	isVirtualAddress,
	parseVirtualAddress,
	SIM_MASTER_ID
} from './index';

describe('domain smoke', () => {
	it('money', () => {
		expect(toUnits('1200.50')).toBe(1200500000n);
		expect(fromUnits(1200500000n)).toBe('1200.50');
		expect(formatUsd('1200500000')).toBe('$1,200.50');
	});
	it('container', () => {
		expect(validateContainerNumber('CSQU3054383')).toBe(true);
		expect(computeCheckDigit('CSQU305438')).toBe(3);
		const n = generateContainerNumber('MRDU', 123456);
		expect(validateContainerNumber(n)).toBe(true);
		expect(formatContainerNumber(n)).toMatch(/^MRDU 123456 \d$/);
	});
	it('va', () => {
		const a = depositAddressFor({ masterId: SIM_MASTER_ID, seq: 1 });
		expect(isVirtualAddress(a)).toBe(true);
		expect(parseVirtualAddress(a)?.masterId).toBe(SIM_MASTER_ID);
	});
});
