import { query } from './_generated/server';
import { chainMode, clockOffset, demoEnabled, env } from './helpers';
import { CHAIN_ID, CHAIN_NAME, EXPLORER_URL, SETTLEMENT_TOKEN } from '../lib/shared/domain/constants';

/** Public: chain mode, sim clock and network info. The backend mode (convex/local) is decided client side. */
export const status = query({
	args: {},
	handler: async (ctx) => {
		const mode = chainMode();
		const offset = await clockOffset(ctx);
		const orgs = await ctx.db.query('organizations').first();
		return {
			chainMode: mode,
			chainId: CHAIN_ID,
			network: CHAIN_NAME,
			explorerUrl: mode === 'live' ? EXPLORER_URL : null,
			settlementToken: SETTLEMENT_TOKEN,
			settlementTokenSymbol: 'AlphaUSD',
			simClockOffsetMs: offset,
			simNow: Date.now() + offset,
			demoMode: demoEnabled(),
			seeded: orgs !== null,
			sponsorUrl: env('PUBLIC_TEMPO_SPONSOR_URL') ?? null
		};
	}
});
