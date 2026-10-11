// Client factories for Tempo Moderato. No env access here (callers pass config), so this module is
// usable from Convex Node actions, the browser and scripts.
import { http as viemHttp } from 'viem';
import { tempoModerato } from 'viem/chains';
import { Account, createClient, http as tempoHttp, withRelay } from 'viem/tempo';
import { DEFAULT_RPC_URL, PATH_USD, type Address, type Hex } from './constants';

/** The public RPC rate-limits in bursts ("Request exceeds defined limit"); back off for several seconds. */
export const rpcTransport = (rpcUrl: string = DEFAULT_RPC_URL) =>
	viemHttp(rpcUrl, { retryCount: 5, retryDelay: 300 });

/** Read-only client (no account). Fees default to pathUSD. */
export function createLiveClient(opts: { rpcUrl?: string } = {}) {
	return createClient({
		chain: tempoModerato,
		feeToken: PATH_USD,
		transport: rpcTransport(opts.rpcUrl)
	});
}

/** Client bound to a local account (server side signer: operator, resolver, access key). */
export function createAccountClient<const account extends Account.Account>(opts: {
	rpcUrl?: string;
	account: account;
}) {
	return createClient({
		account: opts.account,
		chain: tempoModerato,
		feeToken: PATH_USD,
		transport: rpcTransport(opts.rpcUrl)
	});
}

/** Browser client whose fees are paid by a sponsor relay (`feePayer: true` per transaction). */
export function createSponsoredClient(opts: {
	rpcUrl: string;
	sponsorUrl: string;
	account: Account.Account;
}) {
	return createClient({
		account: opts.account,
		chain: tempoModerato,
		feeToken: PATH_USD,
		transport: withRelay(tempoHttp(opts.rpcUrl), tempoHttp(opts.sponsorUrl))
	});
}

export type LiveClient = ReturnType<typeof createLiveClient>;

export const secp256k1Account = (privateKey: Hex, access?: Address) =>
	Account.fromSecp256k1(privateKey, access ? { access } : {});
