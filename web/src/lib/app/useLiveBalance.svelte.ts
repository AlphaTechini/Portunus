/**
 * Live chain only: an account's AlphaUSD balance read straight from Tempo. The backend has no
 * balance in live mode (it never holds the importer's keys), so the browser asks the chain.
 *
 *   const balance = useLiveBalance(() => app.user.passkeyAddress);
 *   balance.units   // bigint | null
 */
import { getBalance } from '../tempo/live.browser';
import type { Address } from '../shared/tempo/live';
import { errorMessage } from './errors';

export function useLiveBalance(address: () => string | null | undefined) {
	let units = $state<bigint | null>(null);
	let loading = $state(false);
	let error = $state('');

	async function refresh() {
		const account = address();
		if (!account) return;
		loading = true;
		error = '';
		try {
			units = await getBalance({ account: account as Address });
		} catch (e) {
			error = errorMessage(e);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (address()) void refresh();
	});

	return {
		get units() {
			return units;
		},
		get loading() {
			return loading;
		},
		get error() {
			return error;
		},
		refresh
	};
}
