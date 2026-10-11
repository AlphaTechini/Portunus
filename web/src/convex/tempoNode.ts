'use node';
// Live Tempo actions (Moderato testnet). Only reached when TEMPO_MODE=live; BACKEND's chain.ts calls these
// via `internal.tempoNode.*`. All results are JSON-safe: bigint values are decimal strings, timestamps are ms.
//
// Secrets (Convex env, brief section 10): TEMPO_SPONSOR_KEY, TEMPO_OPERATOR_KEY, ACCESS_KEY_ENC_KEY,
// PORTUNUS_SETTLEMENT, PORTUNUS_CHARGES, PORTUNUS_MASTER_ID, VA_ENV_PREFIX, optional TEMPO_RPC_URL,
// optional TEMPO_RESOLVER_KEY (defaults to the operator key), LINE_DEPOSITS_KEY (setup only).
// See docs/LIVE-SETUP.md.
import { v } from 'convex/values';
import { generatePrivateKey } from 'viem/accounts';
import { parseAbiItem } from 'viem';
import { Abis, Account, Actions } from 'viem/tempo';
import { internalAction } from './_generated/server';
import {
	ALPHA_USD,
	CHAIN_ID,
	DEFAULT_RPC_URL,
	MAX_LOG_RANGE,
	RECEIVE_POLICY_GUARD,
	createAccountClient,
	createLiveClient,
	decryptSecret,
	encryptSecret,
	heldReceiptFromParts,
	heldReceiptsFromTxReceipt,
	isLimitExceeded,
	keychainErrorOf,
	describeChainError,
	normalizeMemo,
	toMs,
	txResultFromReceipt,
	type Address,
	type HeldReceiptJson,
	type Hex,
	type TxResultJson
} from '../lib/shared/tempo/live';
import { settlementAbi } from '../lib/shared/tempo/settlementAbi';

export type { HeldReceiptJson, TxResultJson };

// Module-local typing for Convex env vars, so this file typechecks whether or not src/convex/tsconfig.json
// includes the Node types.
declare const process: { env: Record<string, string | undefined> };

// ---------------------------------------------------------------------------------------------------------------
// helpers

function need(name: string): string {
	const val = process.env[name];
	if (!val) throw new Error(`Missing Convex env var ${name}. See docs/LIVE-SETUP.md.`);
	return val;
}
const opt = (name: string): string | undefined => process.env[name] || undefined;

const rpcUrl = () => opt('TEMPO_RPC_URL') ?? DEFAULT_RPC_URL;
const publicClient = () => createLiveClient({ rpcUrl: rpcUrl() });
const sponsorAccount = () => Account.fromSecp256k1(need('TEMPO_SPONSOR_KEY') as Hex);
const operatorAccount = () => Account.fromSecp256k1(need('TEMPO_OPERATOR_KEY') as Hex);
const resolverAccount = () =>
	Account.fromSecp256k1((opt('TEMPO_RESOLVER_KEY') ?? need('TEMPO_OPERATOR_KEY')) as Hex);
const settlementAddress = () => need('PORTUNUS_SETTLEMENT') as Address;

/** Gas per settled receipt: claim + up to two transferWithMemo. Explicit gas avoids estimation flakiness. */
const GAS_PER_SETTLEMENT = 2_000_000n;
const MAX_CHUNKS_PER_CALL = 100;

const STATUS_NAMES = ['None', 'Settled', 'Disputed', 'Returned'] as const;
export type SettlementStatus = (typeof STATUS_NAMES)[number];

type LimitExceeded = { error: 'SpendingLimitExceeded'; remainingUnits: string; periodEnd: number };

const TransferBlockedEvent = parseAbiItem(
	'event TransferBlocked(address indexed token, address indexed receiver, uint64 indexed blockedNonce, uint256 amount, uint8 receiptVersion, bytes receipt)'
);

async function accessKeyState(a: { account: Address; keyAddress: Address; token?: Address }) {
	const client = publicClient();
	const token = a.token ?? ALPHA_USD;
	const [limit, meta] = await Promise.all([
		client.accessKey
			.getRemainingLimit({ account: a.account, accessKey: a.keyAddress, token })
			.catch(() => ({ remaining: 0n, periodEnd: undefined as bigint | undefined })),
		client.accessKey.getMetadata({ account: a.account, accessKey: a.keyAddress })
	]);
	return {
		remainingUnits: limit.remaining.toString(),
		periodEnd: limit.periodEnd ? toMs(Number(limit.periodEnd)) : 0,
		expiry: meta.expiry ? toMs(Number(meta.expiry)) : 0,
		isRevoked: meta.isRevoked
	};
}

// ---------------------------------------------------------------------------------------------------------------
// diagnostics

export const health = internalAction({
	args: {},
	handler: async (): Promise<{
		ok: boolean;
		chainId?: number;
		blockNumber?: string;
		error?: string;
	}> => {
		try {
			const client = publicClient();
			const [chainId, blockNumber] = await Promise.all([
				client.getChainId(),
				client.getBlockNumber()
			]);
			return {
				ok: chainId === CHAIN_ID,
				chainId,
				blockNumber: blockNumber.toString(),
				...(chainId === CHAIN_ID ? {} : { error: `unexpected chain id ${chainId}` })
			};
		} catch (e) {
			return { ok: false, error: describeChainError(e) };
		}
	}
});

/** Non-secret live configuration, so BACKEND need not duplicate env parsing. */
export const publicConfig = internalAction({
	args: {},
	handler: async (): Promise<{
		chainId: number;
		rpcUrl: string;
		settlement: string | null;
		charges: string | null;
		masterId: string | null;
		vaEnvPrefix: number | null;
		missing: string[];
	}> => {
		const required = [
			'TEMPO_SPONSOR_KEY',
			'TEMPO_OPERATOR_KEY',
			'ACCESS_KEY_ENC_KEY',
			'PORTUNUS_SETTLEMENT',
			'PORTUNUS_CHARGES',
			'PORTUNUS_MASTER_ID',
			'VA_ENV_PREFIX'
		];
		const prefix = opt('VA_ENV_PREFIX');
		return {
			chainId: CHAIN_ID,
			rpcUrl: rpcUrl(),
			settlement: opt('PORTUNUS_SETTLEMENT') ?? null,
			charges: opt('PORTUNUS_CHARGES') ?? null,
			masterId: opt('PORTUNUS_MASTER_ID') ?? null,
			vaEnvPrefix: prefix === undefined ? null : Number(prefix),
			missing: required.filter((n) => !process.env[n])
		};
	}
});

export const fundFromFaucet = internalAction({
	args: { address: v.string() },
	handler: async (_ctx, { address }): Promise<TxResultJson[]> => {
		const client = publicClient();
		const started = Date.now();
		const receipts = await Actions.faucet.fundSync(client, { account: address as Address });
		return Promise.all(receipts.map((r) => txResultFromReceipt(client, r, started)));
	}
});

export const getBalance = internalAction({
	args: { account: v.string(), token: v.optional(v.string()) },
	handler: async (_ctx, { account, token }): Promise<{ amountUnits: string }> => {
		const amount = await publicClient().readContract({
			address: (token ?? ALPHA_USD) as Address,
			abi: Abis.tip20,
			functionName: 'balanceOf',
			args: [account as Address]
		});
		return { amountUnits: amount.toString() };
	}
});

// ---------------------------------------------------------------------------------------------------------------
// deposits (held mode)

/**
 * Re-reads a deposit transaction the importer signed in the browser and returns one guard receipt per held
 * transfer, in log order. Never trust browser-reported amounts: this is the source of truth.
 */
export const confirmDeposits = internalAction({
	args: { txHash: v.string(), depositsAccount: v.optional(v.string()) },
	handler: async (_ctx, { txHash, depositsAccount }): Promise<HeldReceiptJson[]> => {
		const client = publicClient();
		const receipt = await client.waitForTransactionReceipt({
			hash: txHash as Hex,
			timeout: 30_000,
			checkReplacement: false
		});
		if (receipt.status !== 'success') throw new Error(`transaction ${txHash} reverted`);
		const held = heldReceiptsFromTxReceipt(receipt);
		return depositsAccount
			? held.filter((h) => h.receiver.toLowerCase() === depositsAccount.toLowerCase())
			: held;
	}
});

export const readGuardBalance = internalAction({
	args: { receipt: v.string() },
	handler: async (_ctx, { receipt }): Promise<{ amountUnits: string }> => {
		const amount = await Actions.receivePolicy.getBlockedBalance(publicClient(), {
			receipt: receipt as Hex
		});
		return { amountUnits: amount.toString() };
	}
});

/**
 * Indexer: TransferBlocked logs for `depositsAccount`, scanned in <=50k-block chunks from `fromBlock`.
 * Returns `toBlock` = the last block scanned (inclusive); resume at toBlock + 1. Scans at most
 * MAX_CHUNKS_PER_CALL chunks per call (or `maxBlocks`), so loop until toBlock === head.
 * With the settlement contract configured, each receipt also carries its on-chain settlement status.
 */
export const listHeldReceipts = internalAction({
	args: {
		depositsAccount: v.string(),
		fromBlock: v.string(),
		maxBlocks: v.optional(v.number())
	},
	handler: async (
		_ctx,
		{ depositsAccount, fromBlock, maxBlocks }
	): Promise<{
		receipts: (HeldReceiptJson & { status?: SettlementStatus })[];
		toBlock: string;
		headBlock: string;
	}> => {
		const client = publicClient();
		const head = await client.getBlockNumber();
		let from = BigInt(fromBlock);
		const budget = BigInt(
			Math.min(maxBlocks ?? Number.MAX_SAFE_INTEGER, Number(MAX_LOG_RANGE) * MAX_CHUNKS_PER_CALL)
		);
		const limit = from + budget - 1n < head ? from + budget - 1n : head;
		const out: HeldReceiptJson[] = [];
		let scanned = from - 1n;
		while (from <= limit) {
			const to = from + MAX_LOG_RANGE - 1n < limit ? from + MAX_LOG_RANGE - 1n : limit;
			const logs = await client.getLogs({
				address: RECEIVE_POLICY_GUARD,
				event: TransferBlockedEvent,
				args: { receiver: depositsAccount as Address },
				fromBlock: from,
				toBlock: to,
				strict: true
			});
			for (const l of logs) {
				out.push(
					heldReceiptFromParts({
						receipt: l.args.receipt,
						amount: l.args.amount,
						receiver: l.args.receiver,
						txHash: l.transactionHash,
						logIndex: l.logIndex,
						blockNumber: l.blockNumber
					})
				);
			}
			scanned = to;
			from = to + 1n;
		}
		let statuses: SettlementStatus[] | null = null;
		const settlement = opt('PORTUNUS_SETTLEMENT') as Address | undefined;
		if (settlement && out.length) {
			statuses = await Promise.all(
				out.map(async (h) => {
					const s = await client.readContract({
						address: settlement,
						abi: settlementAbi,
						functionName: 'statusOf',
						args: [h.id]
					});
					return STATUS_NAMES[s] ?? 'None';
				})
			);
		}
		return {
			receipts: out.map((h, i) => (statuses ? { ...h, status: statuses[i] } : h)),
			toBlock: (scanned > head ? head : scanned).toString(),
			headBlock: head.toString()
		};
	}
});

/** On-chain settlement status for receipt ids (keccak256 of the receipt). */
export const settlementStatuses = internalAction({
	args: { ids: v.array(v.string()) },
	handler: async (_ctx, { ids }): Promise<SettlementStatus[]> => {
		const client = publicClient();
		const address = settlementAddress();
		return Promise.all(
			ids.map(async (id) => {
				const s = await client.readContract({
					address,
					abi: settlementAbi,
					functionName: 'statusOf',
					args: [id as Hex]
				});
				return STATUS_NAMES[s] ?? 'None';
			})
		);
	}
});

// ---------------------------------------------------------------------------------------------------------------
// access keys (deposit-free mode)

/** Generates a fresh secp256k1 key. Only its address is ever sent to the browser. */
export const createAccessKey = internalAction({
	args: {},
	handler: async (): Promise<{ keyAddress: string; encPrivKey: string }> => {
		const privateKey = generatePrivateKey();
		const account = Account.fromSecp256k1(privateKey);
		return {
			keyAddress: account.address,
			encPrivKey: await encryptSecret(privateKey, need('ACCESS_KEY_ENC_KEY'))
		};
	}
});

export const getAccessKeyState = internalAction({
	args: { account: v.string(), keyAddress: v.string(), token: v.optional(v.string()) },
	handler: async (
		_ctx,
		a
	): Promise<{ remainingUnits: string; periodEnd: number; expiry: number; isRevoked: boolean }> =>
		accessKeyState({
			account: a.account as Address,
			keyAddress: a.keyAddress as Address,
			token: a.token as Address | undefined
		})
});

/**
 * Pulls `amountUnits` from the importer's account to `to` using the stored access key. The sponsor pays the
 * fee (an unsponsored pull would eat the key's own spending limit). If the chain refuses because the periodic
 * limit is used up, returns { error: 'SpendingLimitExceeded', remainingUnits, periodEnd } (periodEnd in ms)
 * instead of throwing. `memo` may be text (<= 32 bytes) or a 0x bytes32. Set `precheck` to refuse locally
 * without sending; by default the transaction is sent so that the chain itself does the refusing.
 */
export const pullDetention = internalAction({
	args: {
		account: v.string(),
		encPrivKey: v.string(),
		to: v.string(),
		amountUnits: v.string(),
		memo: v.string(),
		token: v.optional(v.string()),
		precheck: v.optional(v.boolean())
	},
	handler: async (_ctx, a): Promise<TxResultJson | LimitExceeded> => {
		const token = (a.token ?? ALPHA_USD) as Address;
		const owner = a.account as Address;
		const amount = BigInt(a.amountUnits);
		const privateKey = (await decryptSecret(a.encPrivKey, need('ACCESS_KEY_ENC_KEY'))) as Hex;
		const lineKey = Account.fromSecp256k1(privateKey, { access: owner });
		const keyAddress = lineKey.accessKeyAddress;

		const asLimitError = async (): Promise<LimitExceeded> => {
			const st = await accessKeyState({ account: owner, keyAddress, token });
			return {
				error: 'SpendingLimitExceeded',
				remainingUnits: st.remainingUnits,
				periodEnd: st.periodEnd
			};
		};

		if (a.precheck) {
			const st = await accessKeyState({ account: owner, keyAddress, token });
			if (BigInt(st.remainingUnits) < amount) return asLimitError();
		}

		const client = createAccountClient({ rpcUrl: rpcUrl(), account: lineKey });
		const started = Date.now();
		try {
			const { receipt } = await client.token.transferSync({
				token,
				to: a.to as Address,
				amount,
				memo: normalizeMemo(a.memo),
				feePayer: sponsorAccount()
			});
			return await txResultFromReceipt(client, receipt, started);
		} catch (e) {
			const kind = keychainErrorOf(e);
			if (kind === 'SpendingLimitExceeded') return asLimitError();
			if (kind === null) {
				// Unknown failure: if the key is live and has less left than we asked for, the limit is the cause.
				try {
					const st = await accessKeyState({ account: owner, keyAddress, token });
					const live = !st.isRevoked && (st.expiry === 0 || st.expiry > Date.now());
					if (live && BigInt(st.remainingUnits) < amount && isLimitLike(e)) return asLimitError();
				} catch {
					// state read failed too; surface the original error
				}
			}
			throw new Error(`pullDetention failed: ${describeChainError(e)}`, { cause: e });
		}
	}
});

/** Estimation-time reverts surface as a generic failure; treat these as "limit-like" for the fallback above. */
const isLimitLike = (e: unknown) =>
	isLimitExceeded(e) ||
	/execution reverted|revert|simulation|estimate/i.test(String((e as Error)?.message));

// ---------------------------------------------------------------------------------------------------------------
// settlement contract (operator)

const settleItem = v.object({
	receipt: v.string(),
	chargeUnits: v.string(),
	disputedUnits: v.string(),
	chargeMemo: v.string(),
	refundMemo: v.string()
});

/** One tx: `settle` for a single item, `settleMany` for several. Operator pays nothing (sponsored). */
export const settle = internalAction({
	args: { items: v.array(settleItem) },
	handler: async (_ctx, { items }): Promise<TxResultJson> => {
		if (items.length === 0) throw new Error('settle: no items');
		const client = createAccountClient({ rpcUrl: rpcUrl(), account: operatorAccount() });
		const started = Date.now();
		const address = settlementAddress();
		const feePayer = sponsorAccount();
		const gas = GAS_PER_SETTLEMENT * BigInt(items.length);
		const common = { address, abi: settlementAbi, feePayer, gas } as const;
		try {
			const receipt =
				items.length === 1
					? await client.writeContractSync({
							...common,
							functionName: 'settle',
							args: [
								items[0].receipt as Hex,
								BigInt(items[0].chargeUnits),
								BigInt(items[0].disputedUnits),
								normalizeMemo(items[0].chargeMemo),
								normalizeMemo(items[0].refundMemo)
							]
						})
					: await client.writeContractSync({
							...common,
							functionName: 'settleMany',
							args: [
								items.map((i) => i.receipt as Hex),
								items.map((i) => BigInt(i.chargeUnits)),
								items.map((i) => BigInt(i.disputedUnits)),
								items.map((i) => normalizeMemo(i.chargeMemo)),
								items.map((i) => normalizeMemo(i.refundMemo))
							]
						});
			return await txResultFromReceipt(client, receipt, started);
		} catch (e) {
			throw new Error(`settle failed: ${describeChainError(e)}`, { cause: e });
		}
	}
});

/** Resolver decision on a disputed receipt: `toLineUnits` to the charges address, the rest to the payer. */
export const resolveDispute = internalAction({
	args: { receipt: v.string(), toLineUnits: v.string(), memo: v.string() },
	handler: async (_ctx, a): Promise<TxResultJson> => {
		const client = createAccountClient({ rpcUrl: rpcUrl(), account: resolverAccount() });
		const started = Date.now();
		try {
			const receipt = await client.writeContractSync({
				address: settlementAddress(),
				abi: settlementAbi,
				functionName: 'resolveDispute',
				args: [a.receipt as Hex, BigInt(a.toLineUnits), normalizeMemo(a.memo)],
				feePayer: sponsorAccount(),
				gas: GAS_PER_SETTLEMENT
			});
			return await txResultFromReceipt(client, receipt, started);
		} catch (e) {
			throw new Error(`resolveDispute failed: ${describeChainError(e)}`, { cause: e });
		}
	}
});

/** Wrong-token / unknown-sender transfers: the whole receipt goes back to its original payer. */
export const returnHeldTransfer = internalAction({
	args: { receipt: v.string() },
	handler: async (_ctx, { receipt }): Promise<TxResultJson> => {
		const client = createAccountClient({ rpcUrl: rpcUrl(), account: operatorAccount() });
		const started = Date.now();
		try {
			const r = await client.writeContractSync({
				address: settlementAddress(),
				abi: settlementAbi,
				functionName: 'returnToSender',
				args: [receipt as Hex],
				feePayer: sponsorAccount(),
				gas: GAS_PER_SETTLEMENT
			});
			return await txResultFromReceipt(client, r, started);
		} catch (e) {
			throw new Error(`returnToSender failed: ${describeChainError(e)}`, { cause: e });
		}
	}
});

/** Anyone may call this once the hold deadline has passed; the operator pays on behalf of the caller. */
export const refundAfterDeadline = internalAction({
	args: { receipt: v.string() },
	handler: async (_ctx, { receipt }): Promise<TxResultJson> => {
		const client = createAccountClient({ rpcUrl: rpcUrl(), account: operatorAccount() });
		const started = Date.now();
		try {
			const r = await client.writeContractSync({
				address: settlementAddress(),
				abi: settlementAbi,
				functionName: 'refundAfterDeadline',
				args: [receipt as Hex],
				feePayer: sponsorAccount(),
				gas: GAS_PER_SETTLEMENT
			});
			return await txResultFromReceipt(client, r, started);
		} catch (e) {
			throw new Error(`refundAfterDeadline failed: ${describeChainError(e)}`, { cause: e });
		}
	}
});
