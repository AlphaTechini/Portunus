/** Organization provisioning helpers shared by auth.registerPasskey, seed and settings. */
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { chainMode, env, lc, simAddress } from './helpers';
import { ensureSimMeta, nextSimLineIndex, registerSimMaster, simFaucet } from './simStore';
import { simMasterIdForIndex } from '../lib/shared/domain/virtualAddress';
import {
	ALPHA_USD,
	DEFAULT_CLEAN_RETURNS_FOR_DEPOSIT_FREE,
	DEFAULT_MAX_DETENTION_DAYS,
	DEFAULT_SETTLEMENT_WINDOW_DAYS
} from '../lib/shared/domain/constants';
import { toUnits } from '../lib/shared/domain/money';

type ContainerType = Doc<'rateCards'>['containerType'];

export const DEFAULT_RATE_CARDS: {
	containerType: ContainerType;
	freeDays: number;
	rate: string;
	deposit: string;
}[] = [
	{ containerType: '20GP', freeDays: 7, rate: '45.00', deposit: '1200.00' },
	{ containerType: '40GP', freeDays: 7, rate: '75.00', deposit: '2000.00' },
	{ containerType: '40HC', freeDays: 7, rate: '80.00', deposit: '2200.00' },
	{ containerType: '20RF', freeDays: 4, rate: '120.00', deposit: '2500.00' },
	{ containerType: '40RF', freeDays: 4, rate: '150.00', deposit: '3500.00' }
];

export async function insertDefaultRateCards(
	ctx: MutationCtx,
	lineOrgId: Id<'organizations'>
): Promise<void> {
	for (const c of DEFAULT_RATE_CARDS) {
		await ctx.db.insert('rateCards', {
			lineOrgId,
			containerType: c.containerType,
			freeDays: c.freeDays,
			dailyRateUnits: toUnits(c.rate).toString(),
			depositUnits: toUnits(c.deposit).toString()
		});
	}
}

/** 'Meridian Ocean Lines' -> 'MRDN'-style short code: consonant-heavy initials, unique. */
export async function makeShortCode(ctx: MutationCtx, name: string): Promise<string> {
	const letters = name.toUpperCase().replace(/[^A-Z]/g, '');
	const words = name
		.toUpperCase()
		.split(/[^A-Z]+/)
		.filter(Boolean);
	let base = words.length >= 2 ? words.map((w) => w[0]).join('') : letters;
	if (base.length < 4) base = (base + letters.replace(/[AEIOU]/g, '') + letters).slice(0, 4);
	base = base.slice(0, 4).padEnd(4, 'X');
	for (let i = 0; i < 100; i++) {
		const candidate = i === 0 ? base : `${base.slice(0, 3)}${i % 10}`;
		const clash = await ctx.db
			.query('organizations')
			.withIndex('by_short_code', (q) => q.eq('shortCode', candidate))
			.first();
		if (!clash) return candidate;
	}
	return `${base.slice(0, 2)}${Math.floor(Math.random() * 90 + 10)}`;
}

/**
 * Give a line its deposits account, charges address, settlement contract and receive policy.
 * Sim: derived fake addresses, registered with the sim guard. Live: addresses from the one-time
 * setup script (env), for the first line only; further lines need their own mined master.
 */
export async function provisionLine(
	ctx: MutationCtx,
	orgId: Id<'organizations'>,
	now: number
): Promise<void> {
	const org = await ctx.db.get(orgId);
	if (!org || org.kind !== 'line') return;
	const resolverOrgId =
		org.resolverOrgId ??
		(
			await ctx.db
				.query('organizations')
				.withIndex('by_kind', (q) => q.eq('kind', 'platform'))
				.first()
		)?._id;
	if (chainMode() === 'live') {
		const masterId = env('PORTUNUS_MASTER_ID');
		const taken = masterId
			? (
					await ctx.db
						.query('organizations')
						.withIndex('by_kind', (q) => q.eq('kind', 'line'))
						.collect()
				).some((l) => l._id !== orgId && l.masterId && lc(l.masterId) === lc(masterId))
			: true;
		if (!masterId || taken) {
			await ctx.db.patch(orgId, { resolverOrgId });
			return;
		}
		const settlement = env('PORTUNUS_SETTLEMENT');
		await ctx.db.patch(orgId, {
			masterId,
			depositsAccount: env('PORTUNUS_DEPOSITS_ACCOUNT'),
			chargesAddress: env('PORTUNUS_CHARGES'),
			settlementContract: settlement,
			receivePolicy: settlement
				? {
						senderPolicy: 'reject-all',
						tokenPolicy: 'allow-all',
						recoveryAuthority: settlement,
						configuredAt: now
					}
				: undefined,
			resolverOrgId
		});
		return;
	}
	await ensureSimMeta(ctx);
	const index = org.simIndex ?? (await nextSimLineIndex(ctx));
	const depositsAccount = org.depositsAccount ?? simAddress(`deposits:${org.shortCode}`);
	const chargesAddress = org.chargesAddress ?? simAddress(`charges:${org.shortCode}`);
	const settlementContract = org.settlementContract ?? simAddress(`settlement:${org.shortCode}`);
	const masterId = org.masterId ?? simMasterIdForIndex(index);
	await ctx.db.patch(orgId, {
		simIndex: index,
		depositsAccount,
		chargesAddress,
		settlementContract,
		masterId,
		receivePolicy: {
			senderPolicy: 'reject-all',
			tokenPolicy: 'allow-all',
			recoveryAuthority: settlementContract,
			configuredAt: now
		},
		settlementWindowDays: org.settlementWindowDays ?? DEFAULT_SETTLEMENT_WINDOW_DAYS,
		cleanReturnsForDepositFree:
			org.cleanReturnsForDepositFree ?? DEFAULT_CLEAN_RETURNS_FOR_DEPOSIT_FREE,
		maxDetentionDays: org.maxDetentionDays ?? DEFAULT_MAX_DETENTION_DAYS,
		resolverOrgId
	});
	await registerSimMaster(ctx, {
		masterId,
		account: depositsAccount,
		settlement: settlementContract,
		charges: chargesAddress,
		resolver: simAddress(`resolver:${org.shortCode}`),
		token: ALPHA_USD
	});
}

/** Sim importers start with 250,000.00 AlphaUSD (ARCHITECTURE section 7). */
export async function fundSimImporter(ctx: MutationCtx, address: string): Promise<void> {
	if (chainMode() === 'live') return;
	await simFaucet(ctx, address, 250_000_000_000n);
}
