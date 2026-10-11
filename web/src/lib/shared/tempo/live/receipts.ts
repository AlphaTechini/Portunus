// Guard receipts (TIP-1028 ClaimReceiptV1) as plain JSON. bigint values are decimal strings so the objects
// cross the Convex boundary unchanged.
import { keccak256, parseEventLogs, type Log } from 'viem';
import { Abis, ReceivePolicyReceipt } from 'viem/tempo';
import { RECEIVE_POLICY_GUARD, type Address, type Hex } from './constants';

/** All addresses in this object are lowercase hex. Compare addresses case-insensitively elsewhere. */
export interface HeldReceiptJson {
	/** keccak256(receipt): the settlement contract's id for this payment. */
	id: Hex;
	/** ABI-encoded ClaimReceiptV1 (320 bytes). */
	receipt: Hex;
	token: Address;
	/** Base units, decimal string. */
	amount: string;
	originator: Address;
	/** The virtual deposit address that was paid. */
	recipient: Address;
	/** The policy subject: the line's deposits account (virtual-address master). */
	receiver: Address;
	recoveryAuthority: Address;
	/** ms since epoch (the receipt stores seconds). */
	blockedAt: number;
	blockedAtSec: number;
	blockedNonce: string;
	/** bytes32 memo carried by the original transfer. */
	memo: Hex;
	blockedReason: 'none' | 'tokenFilter' | 'receivePolicy';
	txHash: Hex;
	logIndex: number;
	blockNumber: string;
}

export const idOfReceipt = (receipt: Hex): Hex => keccak256(receipt);

export function heldReceiptFromParts(p: {
	receipt: Hex;
	amount: bigint;
	receiver: Address;
	txHash: Hex;
	logIndex: number;
	blockNumber: bigint;
}): HeldReceiptJson {
	const d = ReceivePolicyReceipt.decode(p.receipt);
	const lower = (a: string) => a.toLowerCase() as Address;
	return {
		id: idOfReceipt(p.receipt),
		receipt: p.receipt,
		token: lower(d.token),
		amount: p.amount.toString(),
		originator: lower(d.originator),
		recipient: lower(d.recipient),
		receiver: lower(p.receiver),
		recoveryAuthority: lower(d.recoveryAuthority),
		blockedAt: Number(d.blockedAt) * 1000,
		blockedAtSec: Number(d.blockedAt),
		blockedNonce: d.blockedNonce.toString(),
		memo: d.memo,
		blockedReason: d.blockedReason,
		txHash: p.txHash,
		logIndex: p.logIndex,
		blockNumber: p.blockNumber.toString()
	};
}

/** Extracts every TransferBlocked emitted by the guard in a transaction receipt, in log order. */
export function heldReceiptsFromTxReceipt(txReceipt: {
	logs: readonly Log[];
	transactionHash: Hex;
}): HeldReceiptJson[] {
	const guardLogs = txReceipt.logs.filter(
		(l) => l.address.toLowerCase() === RECEIVE_POLICY_GUARD.toLowerCase()
	);
	const parsed = parseEventLogs({
		abi: Abis.receivePolicyGuard,
		eventName: 'TransferBlocked',
		logs: guardLogs as Log[],
		strict: true
	});
	return parsed.map((l) =>
		heldReceiptFromParts({
			receipt: l.args.receipt,
			amount: l.args.amount,
			receiver: l.args.receiver,
			txHash: l.transactionHash ?? txReceipt.transactionHash,
			logIndex: l.logIndex ?? 0,
			blockNumber: l.blockNumber ?? 0n
		})
	);
}
