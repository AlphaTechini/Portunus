// Browser-side live Tempo calls that need the user's own passkey: batch deposits, access-key authorization
// and revocation. Plus read helpers and the faucet. Everything is sponsored (fees paid by the sponsor relay),
// so users never need gas. Only used when TEMPO_MODE=live; sim mode never reaches this file.
//
// Configuration. This SvelteKit version (3) no longer types `$env/dynamic/public` (it is a deprecated alias of
// `$app/env/public`, which only exposes variables declared in src/env.ts), so this module does not import any
// framework env module. The root layout passes the public variables in once, on the client:
//   configureLive({ rpcUrl: PUBLIC_TEMPO_RPC_URL, sponsorUrl: PUBLIC_TEMPO_SPONSOR_URL })
// Defaults (brief section 1 and 4): rpc https://rpc.moderato.tempo.xyz, sponsor https://sponsor.moderato.tempo.xyz
// (public testnet sponsor). To use our own Convex relay set the sponsor to `${PUBLIC_CONVEX_SITE_URL}/tempo/relay`.
import { Abis, Actions, Period } from 'viem/tempo';
import {
	ALPHA_USD,
	DEFAULT_RPC_URL,
	DEFAULT_SPONSOR_URL,
	SECONDS_PER_DAY,
	TRANSFER_WITH_MEMO_SIGNATURE,
	createLiveClient,
	createSponsoredClient,
	explorerTxUrl,
	heldReceiptsFromTxReceipt,
	normalizeMemo,
	toUnixSeconds,
	txResultFromReceipt,
	type Address,
	type Hex,
	type HeldReceiptJson,
	type TxResultJson
} from '../shared/tempo/live';
import { accountFromPasskey, type PasskeyRef } from './passkey';

export type { HeldReceiptJson, TxResultJson, PasskeyRef };

const config: { rpcUrl: string; sponsorUrl: string } = {
	rpcUrl: DEFAULT_RPC_URL,
	sponsorUrl: DEFAULT_SPONSOR_URL
};

/** Overrides the RPC and sponsor URLs. Empty or undefined values keep the defaults. */
export function configureLive(c: { rpcUrl?: string | null; sponsorUrl?: string | null }) {
	if (c.rpcUrl) config.rpcUrl = c.rpcUrl;
	if (c.sponsorUrl) config.sponsorUrl = c.sponsorUrl;
}

export const tempoRpcUrl = () => config.rpcUrl;
export const tempoSponsorUrl = () => config.sponsorUrl;

/** The paying/owning passkey. Extra fields (address, kind) are ignored. */
export type LiveSigner = PasskeyRef & { address?: Address };

function sponsoredClient(signer: LiveSigner) {
	return createSponsoredClient({
		rpcUrl: tempoRpcUrl(),
		sponsorUrl: tempoSponsorUrl(),
		account: accountFromPasskey(signer)
	});
}

const readClient = () => createLiveClient({ rpcUrl: tempoRpcUrl() });

const asBigint = (n: bigint | string | number) => (typeof n === 'bigint' ? n : BigInt(n));

export interface DepositItem {
	/** The container's virtual deposit address. */
	to: Address;
	/** Base units (6 decimals). */
	amount: bigint | string;
	/** bytes32 hex or short text (<= 32 bytes); see shared/domain memos. */
	memo: Hex | string;
}

export type DepositBatchResult = TxResultJson & { held: HeldReceiptJson[] };

/**
 * One atomic, sponsored Tempo transaction paying every container's deposit address: one passkey prompt.
 * Post `txHash` to Convex (deposits.recordLiveBatch); the server re-reads the receipt. `held` is the
 * browser's own decode of the guard receipts, for instant UI only. Never trust it as the record.
 */
export async function payDepositsBatch(a: {
	payer: LiveSigner;
	token?: Address;
	items: DepositItem[];
}): Promise<DepositBatchResult> {
	if (a.items.length === 0) throw new Error('payDepositsBatch: no items');
	const client = sponsoredClient(a.payer);
	const token = a.token ?? ALPHA_USD;
	const calls = a.items.map((i) =>
		Actions.token.transfer.call({
			token,
			to: i.to,
			amount: asBigint(i.amount),
			memo: normalizeMemo(i.memo)
		})
	);
	const started = Date.now();
	// feePayer: true => the relay sponsors the fee and an expiring nonce is used: submit right after signing.
	const receipt = await client.sendTransactionSync({ calls, feePayer: true });
	const tx = await txResultFromReceipt(readClient(), receipt, started);
	return { ...tx, held: heldReceiptsFromTxReceipt(receipt) };
}

/**
 * Importer root key authorizes the server-held access key on their own account: periodic token limit,
 * scoped to transferWithMemo paying only `recipient`, with an expiry. Two passkey prompts (key
 * authorization digest, then the sponsored transaction). `expiry` may be ms or unix seconds.
 */
export async function authorizeAccessKey(a: {
	owner: LiveSigner;
	keyAddress: Address;
	token?: Address;
	/** Base units per period. */
	dailyLimit: bigint | string;
	/** Default 86400 (one day). */
	periodSec?: number;
	/** The line's charges address: the only address the key may pay. */
	recipient: Address;
	expiry: number;
}): Promise<TxResultJson> {
	const client = sponsoredClient(a.owner);
	const token = a.token ?? ALPHA_USD;
	const expiry = toUnixSeconds(a.expiry);
	if (expiry <= Math.floor(Date.now() / 1000)) throw new Error('Access key expiry is in the past.');
	const started = Date.now();
	const { receipt } = await client.accessKey.authorizeSync({
		accessKey: { address: a.keyAddress, type: 'secp256k1' },
		expiry,
		limits: [
			{
				token,
				limit: asBigint(a.dailyLimit),
				period: a.periodSec && a.periodSec !== SECONDS_PER_DAY ? a.periodSec : Period.days(1)
			}
		],
		scopes: [{ address: token, selector: TRANSFER_WITH_MEMO_SIGNATURE, recipients: [a.recipient] }],
		feePayer: true
	});
	return txResultFromReceipt(readClient(), receipt, started);
}

/** Only the importer's root key (passkey) can revoke an access key; the line can never do this. */
export async function revokeKey(a: { owner: LiveSigner; keyAddress: Address }): Promise<TxResultJson> {
	const client = sponsoredClient(a.owner);
	const started = Date.now();
	const { receipt } = await client.accessKey.revokeSync({ accessKey: a.keyAddress, feePayer: true });
	return txResultFromReceipt(readClient(), receipt, started);
}

/** TIP-20 balance in base units. */
export async function getBalance(a: { account: Address; token?: Address }): Promise<bigint> {
	return readClient().readContract({
		address: a.token ?? ALPHA_USD,
		abi: Abis.tip20,
		functionName: 'balanceOf',
		args: [a.account]
	});
}

/** Testnet faucet (tempo_fundAddress): one transaction per token. Fund before any receive policy exists. */
export async function faucet(address: Address): Promise<TxResultJson[]> {
	const client = readClient();
	const started = Date.now();
	const receipts = await Actions.faucet.fundSync(client, { account: address });
	return Promise.all(receipts.map((r) => txResultFromReceipt(client, r, started)));
}

export { explorerTxUrl };
