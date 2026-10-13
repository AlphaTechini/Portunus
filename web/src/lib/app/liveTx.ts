/**
 * Live chain transactions signed with the person's passkey (Tempo Moderato, fees sponsored).
 * Pages pass these as `live` to `app.approve(...)`, so the approval prompt is the transaction
 * signature. They take the backend's plan shapes as-is and return what the backend expects back.
 */
import {
	authorizeAccessKey,
	faucet,
	payDepositsBatch,
	revokeKey,
	type LiveSigner
} from '../tempo/live.browser';
import type { Address } from '../shared/tempo/live';

function need(signer: LiveSigner | null): LiveSigner {
	if (!signer) throw new Error('Sign in with your passkey to sign on Tempo.');
	return signer;
}

/** One batch transaction paying every container's deposit address. One passkey prompt. */
export async function livePayDeposits(
	signer: LiveSigner | null,
	items: { to: string; amountUnits: string; memoHex: string }[]
): Promise<{ txHash: string }> {
	const r = await payDepositsBatch({
		payer: need(signer),
		items: items.map((i) => ({ to: i.to as Address, amount: i.amountUnits, memo: i.memoHex }))
	});
	return { txHash: r.txHash };
}

/** Authorizes each prepared access key in turn. Two passkey prompts per key. */
export async function liveAuthorizeKeys(
	signer: LiveSigner | null,
	keys: {
		containerId: string;
		keyAddress: string;
		token: string;
		dailyLimitUnits: string;
		periodSec: number;
		recipient: string;
		expiry: number;
	}[]
): Promise<{ containerId: string; txHash: string }[]> {
	const owner = need(signer);
	const out: { containerId: string; txHash: string }[] = [];
	for (const k of keys) {
		const r = await authorizeAccessKey({
			owner,
			keyAddress: k.keyAddress as Address,
			token: k.token as Address,
			dailyLimit: k.dailyLimitUnits,
			periodSec: k.periodSec,
			recipient: k.recipient as Address,
			expiry: k.expiry
		});
		out.push({ containerId: k.containerId, txHash: r.txHash });
	}
	return out;
}

/** Revokes an access key with the root passkey. One passkey prompt. */
export async function liveRevokeKey(
	signer: LiveSigner | null,
	keyAddress: string
): Promise<{ txHash: string }> {
	const r = await revokeKey({ owner: need(signer), keyAddress: keyAddress as Address });
	return { txHash: r.txHash };
}

/** Testnet faucet: funds the account with every test stablecoin. No passkey prompt. */
export async function liveFaucet(address: string): Promise<number> {
	return (await faucet(address as Address)).length;
}
