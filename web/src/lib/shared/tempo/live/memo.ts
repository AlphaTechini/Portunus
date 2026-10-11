// TIP-20 memos are bytes32. Portunus memos are short UTF-8 strings, right-padded with zero bytes
// (the encoding the Tempo docs recommend). BACKEND owns the memo grammar (shared/domain); this is only the codec.
import { hexToString, toHex } from 'viem';
import type { Hex } from './constants';

export const ZERO_MEMO: Hex = `0x${'00'.repeat(32)}`;

export function memoByteLength(s: string): number {
	return new TextEncoder().encode(s).length;
}

export function encodeMemo(s: string): Hex {
	if (memoByteLength(s) > 32) throw new Error(`memo is longer than 32 bytes: "${s}"`);
	return toHex(s, { size: 32 });
}

export function decodeMemo(memo: Hex): string {
	return hexToString(memo, { size: 32 });
}

export const isBytes32Hex = (s: string): s is Hex => /^0x[0-9a-fA-F]{64}$/.test(s);

/**
 * Accepts either a 0x-prefixed bytes32 or a plain text memo. The empty string maps to the zero memo.
 * Convex boundary helper: callers may pass whichever form they already hold.
 */
export function normalizeMemo(memo: string | undefined | null): Hex {
	if (!memo) return ZERO_MEMO;
	return isBytes32Hex(memo) ? (memo.toLowerCase() as Hex) : encodeMemo(memo);
}
