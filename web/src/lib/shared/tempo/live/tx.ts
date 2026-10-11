import { explorerTxUrl, type Hex } from './constants';

/** What every live write returns across the Convex boundary (bigint as decimal strings). */
export interface TxResultJson {
	mode: 'live';
	txHash: Hex;
	blockNumber: string;
	/** ms since epoch (block timestamp). */
	timestamp: number;
	explorerUrl: string;
	/** Wall-clock ms from submission to receipt. */
	finalityMs: number;
}

interface BlockReader {
	getBlock(args: { blockNumber: bigint }): Promise<{ timestamp: bigint }>;
}

/** Builds a TxResultJson from a mined receipt. `startedAtMs` is when the call was submitted. */
export async function txResultFromReceipt(
	client: BlockReader,
	receipt: { transactionHash: Hex; blockNumber: bigint },
	startedAtMs: number,
	finishedAtMs: number = Date.now()
): Promise<TxResultJson> {
	let timestamp = finishedAtMs;
	try {
		const block = await client.getBlock({ blockNumber: receipt.blockNumber });
		timestamp = Number(block.timestamp) * 1000;
	} catch {
		// Block lookup is cosmetic; fall back to the wall clock.
	}
	return {
		mode: 'live',
		txHash: receipt.transactionHash,
		blockNumber: receipt.blockNumber.toString(),
		timestamp,
		explorerUrl: explorerTxUrl(receipt.transactionHash),
		finalityMs: Math.max(0, finishedAtMs - startedAtMs)
	};
}
