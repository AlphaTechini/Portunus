/**
 * Memo grammar (brief section 2). A TIP-20 memo is exactly 32 bytes, so the
 * record carries a compact, human readable string right-padded with zeros.
 * The full record (B/L, EIR, amounts) lives in Convex, joined by container number.
 *
 *   PD <container11> <BL, last 17 chars>          deposit
 *   PC <container11> D<nn> <BL tail, <=12 chars>  detention pull, day nn
 *   PS <container11> <EIR, last 17 chars>         settlement charge
 *   PR <container11> <EIR, last 17 chars>         refund
 *   PX <first 16 hex of receipt id>               held transfer return
 *   KA <container11> <BL, last 17 chars>          access key authorized (Portunus extension)
 *   KR <container11> <EIR or BL tail>             access key revoked (Portunus extension)
 *   DR <container11> <EIR, last 17 chars>         dispute resolution payout (Portunus extension)
 */

export type Hex = `0x${string}`;

export const MEMO_BYTES = 32;

export type MemoKind =
	| 'deposit'
	| 'pull'
	| 'charge'
	| 'refund'
	| 'heldReturn'
	| 'keyAuthorized'
	| 'keyRevoked'
	| 'disputeRelease';

const PREFIX: Record<MemoKind, string> = {
	deposit: 'PD',
	pull: 'PC',
	charge: 'PS',
	refund: 'PR',
	heldReturn: 'PX',
	keyAuthorized: 'KA',
	keyRevoked: 'KR',
	disputeRelease: 'DR'
};

const KIND_BY_PREFIX: Record<string, MemoKind> = Object.fromEntries(
	Object.entries(PREFIX).map(([k, p]) => [p, k as MemoKind])
);

/** Keep references printable and free of spaces so the grammar stays parseable. */
export function sanitizeRef(ref: string): string {
	return ref.trim().replace(/[^A-Za-z0-9._/-]+/g, '-');
}

export function tail(ref: string, n: number): string {
	const s = sanitizeRef(ref);
	return s.length <= n ? s : s.slice(s.length - n);
}

export function encodeMemo(text: string): Hex {
	const bytes = new TextEncoder().encode(text);
	if (bytes.length > MEMO_BYTES) throw new Error(`memo > ${MEMO_BYTES} bytes: ${text}`);
	let hex = '';
	for (const b of bytes) hex += b.toString(16).padStart(2, '0');
	return `0x${hex.padEnd(MEMO_BYTES * 2, '0')}`;
}

export function decodeMemo(memo: string): string {
	const h = memo.startsWith('0x') ? memo.slice(2) : memo;
	const bytes = new Uint8Array(Math.floor(h.length / 2));
	for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
	let end = bytes.length;
	while (end > 0 && bytes[end - 1] === 0) end--;
	return new TextDecoder().decode(bytes.slice(0, end));
}

// Builders return the decoded text; use encodeMemo for the bytes32.

export const depositMemo = (container: string, billOfLading: string): string =>
	`PD ${container} ${tail(billOfLading, 17)}`;

export const pullMemo = (container: string, day: number, billOfLading: string): string =>
	`PC ${container} D${String(day).padStart(2, '0')} ${tail(billOfLading, 12)}`;

export const chargeMemo = (container: string, eir: string): string =>
	`PS ${container} ${tail(eir, 17)}`;

export const refundMemo = (container: string, eir: string): string =>
	`PR ${container} ${tail(eir, 17)}`;

export const heldReturnMemo = (receiptId: string): string =>
	`PX ${receiptId.replace(/^0x/, '').slice(0, 16)}`;

export const keyAuthorizedMemo = (container: string, billOfLading: string): string =>
	`KA ${container} ${tail(billOfLading, 17)}`;

export const keyRevokedMemo = (container: string, ref: string): string =>
	`KR ${container} ${tail(ref, 17)}`;

export const disputeReleaseMemo = (container: string, eir: string): string =>
	`DR ${container} ${tail(eir, 17)}`;

export interface ParsedMemo {
	kind: MemoKind | null;
	container?: string;
	day?: number;
	reference?: string;
	raw: string;
}

/** Best effort parse for display (memo trail). */
export function parseMemo(text: string): ParsedMemo {
	const raw = text;
	const parts = text.split(' ');
	const kind = KIND_BY_PREFIX[parts[0]] ?? null;
	if (!kind) return { kind: null, raw };
	if (kind === 'heldReturn') return { kind, reference: parts[1], raw };
	const container = parts[1];
	if (kind === 'pull') {
		const day = /^D(\d+)$/.exec(parts[2] ?? '');
		return { kind, container, day: day ? Number(day[1]) : undefined, reference: parts[3], raw };
	}
	return { kind, container, reference: parts[2], raw };
}

export const MEMO_LABELS: Record<MemoKind, string> = {
	deposit: 'Deposit',
	pull: 'Detention pull',
	charge: 'Settlement charge',
	refund: 'Refund',
	heldReturn: 'Held transfer returned',
	keyAuthorized: 'Access key authorized',
	keyRevoked: 'Access key revoked',
	disputeRelease: 'Dispute payout'
};
