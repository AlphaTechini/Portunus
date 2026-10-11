/**
 * Demo world (ARCHITECTURE section 7). Fictional companies only.
 *
 * History is produced by running the REAL operations (create request, batch deposit through the
 * sim guard, release, daily detention, return, settlement) with explicit past timestamps, so every
 * past step has its memo-trail payment, the sim ledger balances, and the dashboards have 60 days
 * of believable data. Refunds land seconds after the return is recorded.
 */
import { internalMutation, mutation } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { chainMode, simAddress } from './helpers';
import { getSimChain, simTxJson, ensureSimMeta } from './simStore';
import { insertDefaultRateCards, provisionLine, fundSimImporter } from './orgSetup';
import { createReleaseRequest } from './opsRequests';
import { ingestReceipts } from './opsDeposits';
import {
	detentionStepOp,
	pullResultOp,
	recordReturnOp,
	releaseRequestContainers,
	scheduleKeyExpiryWarning,
	scheduleNextJob
} from './opsLifecycle';
import { insertPreparedKey, recordKeyAuthorizedOp, recordKeyRevokedOp } from './opsKeys';
import {
	beginSettlementOp,
	finishDepositFreeSettlementOp,
	finishHeldSettlementOp
} from './opsSettlement';
import { logEvent, notify } from './helpers';
import type { SimChain } from '../lib/shared/tempo/sim';
import { ALPHA_USD, BETA_USD, DAY_MS, HOUR_MS } from '../lib/shared/domain/constants';
import { generateContainerNumber } from '../lib/shared/domain/containerNumber';
import { depositMemo, encodeMemo, type Hex } from '../lib/shared/domain/memo';
import { toUnits, formatUsd, u } from '../lib/shared/domain/money';

type Org = Doc<'organizations'>;
type User = Doc<'users'>;
type CType = Doc<'containers'>['type'];

const MIN = 60_000;

/** Tiny deterministic generator so the demo world is identical on every reset. */
function rng(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
		return s / 0x100000000;
	};
}

interface World {
	T0: number;
	chain: SimChain;
	meridian: Org;
	kestrel: Org;
	harbourview: Org;
	savanna: Org;
	pasig: Org;
	users: Record<string, User>;
	serial: Record<string, number>;
	rand: () => number;
	blCounter: number;
}

export async function seedWorld(ctx: MutationCtx): Promise<{ containers: number }> {
	const T0 = Date.now();
	await ensureSimMeta(ctx);
	const chain = await getSimChain(ctx);

	// --- organizations ------------------------------------------------------------------
	const platformId = await ctx.db.insert('organizations', {
		kind: 'platform',
		name: 'Portunus Resolution Desk',
		shortCode: 'PRTN',
		country: 'Global',
		blurb: 'Default dispute resolver for lines and importers who both agreed to it at onboarding.',
		createdAt: T0 - 90 * DAY_MS
	});
	const mkLine = async (
		name: string,
		shortCode: string,
		country: string,
		prefix: string,
		blurb: string
	) => {
		const id = await ctx.db.insert('organizations', {
			kind: 'line',
			name,
			shortCode,
			country,
			containerPrefix: prefix,
			blurb,
			settlementWindowDays: 3,
			cleanReturnsForDepositFree: 3,
			maxDetentionDays: 30,
			createdAt: T0 - 90 * DAY_MS
		});
		await provisionLine(ctx, id, T0 - 90 * DAY_MS);
		return id;
	};
	const meridianId = await mkLine(
		'Meridian Ocean Lines',
		'MRDN',
		'Nigeria',
		'MRDU',
		'Carrier with a Lagos (Apapa) import desk.'
	);
	const kestrelId = await mkLine(
		'Kestrel Container Line',
		'KSTL',
		'Kenya',
		'KSTU',
		'Carrier with a Mombasa import desk.'
	);
	await insertDefaultRateCards(ctx, meridianId);
	const kestrelCards: [CType, number, string, string][] = [
		['20GP', 5, '40.00', '1000.00'],
		['40GP', 5, '70.00', '1800.00'],
		['40HC', 5, '75.00', '2000.00'],
		['20RF', 4, '110.00', '2200.00'],
		['40RF', 4, '140.00', '3200.00']
	];
	for (const [containerType, freeDays, rate, deposit] of kestrelCards) {
		await ctx.db.insert('rateCards', {
			lineOrgId: kestrelId,
			containerType,
			freeDays,
			dailyRateUnits: toUnits(rate).toString(),
			depositUnits: toUnits(deposit).toString()
		});
	}
	const mkImporter = async (name: string, shortCode: string, country: string, blurb: string) => {
		const address = simAddress(`importer:${shortCode}`);
		const id = await ctx.db.insert('organizations', {
			kind: 'importer',
			name,
			shortCode,
			country,
			tempoAddress: address,
			blurb,
			createdAt: T0 - 80 * DAY_MS
		});
		await fundSimImporter(ctx, address);
		return id;
	};
	const harbourviewId = await mkImporter(
		'Harbourview Foods Ltd',
		'HRBV',
		'Nigeria',
		'Food importer in Lagos. New to the platform.'
	);
	const savannaId = await mkImporter(
		'Savanna Agro Traders',
		'SVNA',
		'Kenya',
		'Agro trader in Mombasa with a clean record.'
	);
	const pasigId = await mkImporter(
		'Pasig Valley Imports',
		'PSGV',
		'Philippines',
		'Importer in Manila.'
	);

	const orgs = async (id: Id<'organizations'>) => (await ctx.db.get(id))!;
	const meridian = await orgs(meridianId);
	const kestrel = await orgs(kestrelId);
	const harbourview = await orgs(harbourviewId);
	const savanna = await orgs(savannaId);
	const pasig = await orgs(pasigId);

	// --- people (demo personas, no passkeys) -----------------------------------------------
	const mkUser = async (
		key: string,
		orgId: Id<'organizations'>,
		role: 'line' | 'importer' | 'platform',
		name: string,
		title: string,
		blurb: string,
		email: string
	) => {
		const id = await ctx.db.insert('users', {
			orgId,
			name,
			role,
			title,
			blurb,
			email,
			demo: true,
			createdAt: T0 - 80 * DAY_MS
		});
		return [key, (await ctx.db.get(id))!] as const;
	};
	const users = Object.fromEntries([
		await mkUser(
			'adaeze',
			meridianId,
			'line',
			'Adaeze Okafor',
			'Import Desk Lead, Lagos (Apapa)',
			'Creates release requests, records returns and posts charges for Meridian Ocean Lines.',
			'adaeze@meridian.example'
		),
		await mkUser(
			'joseph',
			kestrelId,
			'line',
			'Joseph Otieno',
			'Import Desk Agent, Mombasa',
			'Runs the Kestrel Container Line import desk.',
			'joseph@kestrel.example'
		),
		await mkUser(
			'tunde',
			harbourviewId,
			'importer',
			'Tunde Bakare',
			'Clearing agent',
			'Acts for Harbourview Foods. Has a three-container request waiting for payment.',
			'tunde@harbourview.example'
		),
		await mkUser(
			'wanjiru',
			savannaId,
			'importer',
			'Wanjiru Mwangi',
			'Operations lead',
			'Six clean returns, so lines offer deposit-free release. Has a request waiting for authorization.',
			'wanjiru@savanna.example'
		),
		await mkUser(
			'carlo',
			pasigId,
			'importer',
			'Carlo Reyes',
			'Customs broker',
			'Pays held deposits. One charge is currently in dispute.',
			'carlo@pasig.example'
		),
		await mkUser(
			'desk',
			platformId,
			'platform',
			'Resolution Desk',
			'Dispute resolver',
			'Decides disputes both sides agreed to bring to the platform.',
			'desk@portunus.example'
		)
	]) as Record<string, User>;

	const w: World = {
		T0,
		chain,
		meridian,
		kestrel,
		harbourview,
		savanna,
		pasig,
		users,
		serial: { MRDU: 482310, KSTU: 337105 },
		rand: rng(20261011),
		blCounter: 0
	};
	let count = 0;

	// --- 14 settled containers over ~60 days ----------------------------------------------
	type Hist = {
		line: Org;
		imp: Org;
		mode: 'held' | 'depositFree';
		type: CType;
		age: number;
		late: number;
	};
	const hist: Hist[] = [
		{ line: meridian, imp: savanna, mode: 'held', type: '20GP', age: 57, late: 0 },
		{ line: meridian, imp: savanna, mode: 'held', type: '40GP', age: 47, late: 0 },
		{ line: meridian, imp: savanna, mode: 'held', type: '20GP', age: 39, late: 0 },
		{ line: meridian, imp: savanna, mode: 'depositFree', type: '40HC', age: 30, late: 0 },
		{ line: meridian, imp: savanna, mode: 'depositFree', type: '20GP', age: 22, late: 0 },
		{ line: meridian, imp: savanna, mode: 'depositFree', type: '40GP', age: 16, late: 0 },
		{ line: meridian, imp: pasig, mode: 'held', type: '40GP', age: 53, late: 0 },
		{ line: meridian, imp: pasig, mode: 'held', type: '20GP', age: 43, late: 2 },
		{ line: meridian, imp: pasig, mode: 'held', type: '40HC', age: 34, late: 0 },
		{ line: meridian, imp: pasig, mode: 'held', type: '20GP', age: 26, late: 0 },
		{ line: meridian, imp: harbourview, mode: 'held', type: '20GP', age: 19, late: 0 },
		{ line: kestrel, imp: savanna, mode: 'held', type: '40GP', age: 49, late: 0 },
		{ line: kestrel, imp: savanna, mode: 'held', type: '20GP', age: 37, late: 1 },
		{ line: kestrel, imp: savanna, mode: 'held', type: '40HC', age: 28, late: 0 }
	];
	for (const h of hist) {
		await runContainer(ctx, w, {
			line: h.line,
			imp: h.imp,
			mode: h.mode,
			type: h.type,
			createdAt: T0 - h.age * DAY_MS,
			stage: 'settled',
			lateDays: h.late
		});
		count++;
	}

	// --- currently active ----------------------------------------------------------------
	const active: Parameters<typeof runContainer>[2][] = [
		// 3 in free time
		{
			line: meridian,
			imp: harbourview,
			mode: 'held',
			type: '40GP',
			createdAt: T0 - 2.3 * DAY_MS,
			releaseAt: T0 - 2 * DAY_MS,
			stage: 'free_time'
		},
		{
			line: meridian,
			imp: pasig,
			mode: 'held',
			type: '20GP',
			createdAt: T0 - 4.2 * DAY_MS,
			releaseAt: T0 - 4 * DAY_MS,
			stage: 'free_time'
		},
		{
			line: meridian,
			imp: savanna,
			mode: 'depositFree',
			type: '40HC',
			createdAt: T0 - 1.7 * DAY_MS,
			releaseAt: T0 - 1.5 * DAY_MS,
			stage: 'free_time'
		},
		// 2 in detention (one held, one deposit-free with pulls)
		{
			line: meridian,
			imp: pasig,
			mode: 'held',
			type: '40GP',
			createdAt: T0 - 10 * DAY_MS,
			releaseAt: T0 - 9.6 * DAY_MS,
			stage: 'detention'
		},
		{
			line: meridian,
			imp: savanna,
			mode: 'depositFree',
			type: '20GP',
			createdAt: T0 - 9.9 * DAY_MS,
			releaseAt: T0 - 9.4 * DAY_MS,
			stage: 'detention'
		},
		// 1 returned, waiting for the settlement window
		{
			line: meridian,
			imp: harbourview,
			mode: 'held',
			type: '40HC',
			createdAt: T0 - 8.6 * DAY_MS,
			releaseAt: T0 - 8.2 * DAY_MS,
			returnAt: T0 - 1 * DAY_MS,
			stage: 'returned'
		},
		// 1 disputed
		{
			line: meridian,
			imp: pasig,
			mode: 'held',
			type: '40RF',
			createdAt: T0 - 14.4 * DAY_MS,
			releaseAt: T0 - 14 * DAY_MS,
			returnAt: T0 - 4.7 * DAY_MS,
			damage: '400.00',
			damageNote: 'Door seal torn on return inspection',
			dispute: {
				at: T0 - 3.5 * DAY_MS,
				units: '500.00',
				reason: 'The seal damage was already noted on the pickup inspection. Photos attached.'
			},
			stage: 'disputed'
		}
	];
	for (const a of active) {
		await runContainer(ctx, w, a);
		count++;
	}

	// --- open release requests -----------------------------------------------------------
	// The demo-video scenario: three containers awaiting Harbourview's deposit.
	const bl1 = nextBl(w, meridian);
	const reqA = await createReleaseRequest(ctx, {
		line: meridian,
		user: users.adaeze,
		importerOrgId: harbourview._id,
		billOfLading: bl1,
		vessel: 'MV Harbour Star',
		voyage: '041E',
		portOfDischarge: 'Apapa, Lagos',
		mode: 'held',
		containers: (['40GP', '40GP', '20GP'] as CType[]).map((type) => ({
			number: nextNumber(w, meridian),
			type
		})),
		now: T0 - 35 * MIN
	});
	// A deposit-free request waiting for Savanna's authorization.
	const bl2 = nextBl(w, meridian);
	await createReleaseRequest(ctx, {
		line: meridian,
		user: users.adaeze,
		importerOrgId: savanna._id,
		billOfLading: bl2,
		vessel: 'MV Lagos Trader',
		voyage: '112W',
		portOfDischarge: 'Apapa, Lagos',
		mode: 'depositFree',
		containers: (['20GP', '40GP'] as CType[]).map((type) => ({
			number: nextNumber(w, meridian),
			type
		})),
		now: T0 - 2 * HOUR_MS
	});
	count += 5;

	// --- two held transfers ---------------------------------------------------------------
	const stranger = simAddress('stranger:demo');
	await chain.fund(stranger, ALPHA_USD, 10_000_000_000n);
	await chain.fund(stranger, BETA_USD, 10_000_000_000n);
	const firstWaiting = await ctx.db.get(reqA.containerIds[0]);
	const wrongToken = await chain.transferBatch({
		from: stranger,
		token: BETA_USD,
		calls: [
			{
				to: firstWaiting!.depositAddress,
				amount: toUnits('250.00'),
				memo: encodeMemo(`PD ${firstWaiting!.number} WRONGTOKEN`)
			}
		],
		at: T0 - 2 * HOUR_MS
	});
	await ingestReceipts(ctx, wrongToken.held, {
		mode: 'sim',
		finalityMs: wrongToken.tx.finalityMs,
		now: T0 - 2 * HOUR_MS,
		blockNumber: String(wrongToken.tx.blockNumber)
	});
	const unknown = await chain.transferBatch({
		from: stranger,
		token: ALPHA_USD,
		calls: [
			{
				to: meridian.depositsAccount!,
				amount: toUnits('175.00'),
				memo: encodeMemo('PAYMENT REF 88213')
			}
		],
		at: T0 - 5 * HOUR_MS
	});
	await ingestReceipts(ctx, unknown.held, {
		mode: 'sim',
		finalityMs: unknown.tx.finalityMs,
		now: T0 - 5 * HOUR_MS,
		blockNumber: String(unknown.tx.blockNumber)
	});

	// --- schedule the live jobs for what is still running ---------------------------------
	const running = await ctx.db.query('containers').collect();
	for (const c of running) {
		if (['in_free_time', 'in_detention', 'returned'].includes(c.state)) {
			await scheduleNextJob(ctx, c._id, T0);
			if (c.mode === 'depositFree' && c.state !== 'returned')
				await scheduleKeyExpiryWarning(ctx, c._id);
		}
	}
	// Old notifications are read; the last day's stay unread.
	for (const n of await ctx.db.query('notifications').collect()) {
		if (n.createdAt < T0 - DAY_MS) await ctx.db.patch(n._id, { readAt: n.createdAt + HOUR_MS });
	}
	return { containers: count };
}

function nextNumber(w: World, line: Org): string {
	const prefix = line.containerPrefix ?? 'MRDU';
	const serial = (w.serial[prefix] = (w.serial[prefix] ?? 100000) + 1 + Math.floor(w.rand() * 37));
	return generateContainerNumber(prefix, serial);
}

function nextBl(w: World, line: Org): string {
	w.blCounter++;
	const port = line.shortCode === 'KSTL' ? 'MBA' : 'LOS';
	return `${line.shortCode}${port}${26000 + w.blCounter * 17}`;
}

interface Spec {
	line: Org;
	imp: Org;
	mode: 'held' | 'depositFree';
	type: CType;
	createdAt: number;
	stage: 'settled' | 'free_time' | 'detention' | 'returned' | 'disputed';
	releaseAt?: number;
	returnAt?: number;
	lateDays?: number;
	damage?: string;
	damageNote?: string;
	dispute?: { at: number; units: string; reason: string };
}

const lineUserFor = (w: World, line: Org): User =>
	line.shortCode === 'KSTL' ? w.users.joseph : w.users.adaeze;
const impUserFor = (w: World, imp: Org): User =>
	imp.shortCode === 'HRBV'
		? w.users.tunde
		: imp.shortCode === 'SVNA'
			? w.users.wanjiru
			: w.users.carlo;

/** Run one container through the real operations up to `spec.stage`, with explicit past timestamps. */
async function runContainer(ctx: MutationCtx, w: World, spec: Spec): Promise<Id<'containers'>> {
	const { chain, T0 } = w;
	const lineUser = lineUserFor(w, spec.line);
	const impUser = impUserFor(w, spec.imp);
	const bl = nextBl(w, spec.line);
	const number = nextNumber(w, spec.line);
	const jitter = (min: number, spanMin: number) => (min + Math.floor(w.rand() * spanMin)) * MIN;

	const tCreate = spec.createdAt;
	const created = await createReleaseRequest(ctx, {
		line: spec.line,
		user: lineUser,
		importerOrgId: spec.imp._id,
		billOfLading: bl,
		vessel: spec.line.shortCode === 'KSTL' ? 'MV Indian Gull' : 'MV Atlantic Reef',
		voyage: `${100 + Math.floor(w.rand() * 800)}E`,
		portOfDischarge: spec.line.shortCode === 'KSTL' ? 'Mombasa' : 'Apapa, Lagos',
		mode: spec.mode,
		containers: [{ number, type: spec.type }],
		now: tCreate
	});
	const containerId = created.containerIds[0];
	const payer = spec.imp.tempoAddress!;
	const tCover = tCreate + jitter(70, 120);
	let container = (await ctx.db.get(containerId))!;

	if (spec.mode === 'held') {
		const res = await chain.transferBatch({
			from: payer,
			token: ALPHA_USD,
			calls: [
				{
					to: container.depositAddress,
					amount: u(container.depositUnits),
					memo: encodeMemo(depositMemo(number, bl)) as Hex
				}
			],
			at: tCover
		});
		await ingestReceipts(ctx, res.held, {
			mode: 'sim',
			finalityMs: res.tx.finalityMs,
			now: tCover,
			blockNumber: String(res.tx.blockNumber),
			approvedWith: 'demo'
		});
	} else {
		const keyAddress = `0x${Array.from({ length: 40 }, () => Math.floor(w.rand() * 16).toString(16)).join('')}`;
		const keyId = await insertPreparedKey(ctx, {
			container,
			line: spec.line,
			account: payer,
			keyAddress,
			encPrivKey: 'sim:seed',
			mode: 'sim',
			now: tCover
		});
		const key = (await ctx.db.get(keyId))!;
		const auth = await chain.authorizeKey({
			account: payer,
			keyId: keyAddress,
			token: ALPHA_USD,
			limit: u(key.dailyLimitUnits),
			periodSec: key.periodSec,
			recipients: [key.recipient],
			expiry: key.expiry,
			at: tCover
		});
		await recordKeyAuthorizedOp(ctx, {
			keyId,
			tx: simTxJson(auth.tx),
			now: tCover,
			approvedWith: 'demo',
			actor: impUser.name
		});
	}

	const tRelease = spec.releaseAt ?? tCover + jitter(20, 60);
	await releaseRequestContainers(ctx, created.requestId, tRelease, lineUser.name, {
		schedule: false
	});
	container = (await ctx.db.get(containerId))!;
	const F = container.freeTimeEndsAt!;

	const processDetention = async (now: number) => {
		for (let i = 0; i < 60; i++) {
			const step = await detentionStepOp(ctx, containerId, now);
			if (step.kind === 'done') return;
			const r = await chain.pull({
				account: step.account,
				keyId: step.keyAddress,
				token: ALPHA_USD,
				to: step.to,
				amount: u(step.amountUnits),
				memo: step.memoHex,
				at: step.dueAt
			});
			await pullResultOp(ctx, {
				containerId,
				day: step.day,
				dueAt: step.dueAt,
				amountUnits: step.amountUnits,
				memo: step.memo,
				memoHex: step.memoHex,
				account: step.account,
				to: step.to,
				result: { ok: true, tx: simTxJson(r.tx) },
				now: step.dueAt
			});
		}
	};

	if (spec.stage === 'free_time') return containerId;
	if (spec.stage === 'detention') {
		await processDetention(T0);
		return containerId;
	}

	// Return of the empty.
	const lateDays = spec.lateDays ?? 0;
	const tReturn =
		spec.returnAt ??
		(lateDays > 0
			? F + (lateDays - 1) * DAY_MS + 0.4 * DAY_MS
			: F - Math.floor((1 + w.rand() * 2) * DAY_MS));
	await processDetention(tReturn);
	await recordReturnOp(
		ctx,
		containerId,
		{
			eirNumber: `EIR-${spec.line.shortCode}-${(700000 + Math.floor(w.rand() * 99999)).toString()}`,
			date: tReturn,
			depot: spec.line.shortCode === 'KSTL' ? 'Mombasa Container Terminal depot' : 'Apapa Yard 3'
		},
		'line',
		tReturn,
		lineUser.name,
		{ schedule: false }
	);
	if (spec.stage === 'returned') return containerId;

	const settleOnce = async (opts: {
		now: number;
		source: 'line' | 'dispute';
		damage?: string;
		note?: string;
		disputed?: string;
	}) => {
		const plan = await beginSettlementOp(ctx, {
			containerId,
			now: opts.now,
			source: opts.source,
			damageUnits: opts.damage,
			note: opts.note,
			disputedUnits: opts.disputed,
			dispute: opts.disputed
				? { openedBy: impUser._id, reason: spec.dispute?.reason ?? '' }
				: undefined,
			actor: opts.source === 'dispute' ? impUser.name : lineUser.name
		});
		if (plan.mode === 'held') {
			const r = await chain.settle({
				items: plan.items.map((i) => ({
					receiptId: i.receiptId,
					charge: u(i.chargeUnits),
					disputed: u(i.disputedUnits),
					chargeMemo: i.chargeMemoHex,
					refundMemo: i.refundMemoHex
				})),
				at: opts.now
			});
			await finishHeldSettlementOp(ctx, plan, {
				tx: simTxJson(r.tx),
				legs: r.legs,
				now: opts.now,
				actor: lineUser.name
			});
		} else {
			const df = plan.depositFree!;
			const rv = await chain.revokeKey({ account: df.account, keyId: df.keyAddress, at: opts.now });
			await finishDepositFreeSettlementOp(ctx, plan, {
				now: opts.now,
				actor: lineUser.name,
				revokeTx: simTxJson(rv.tx),
				revokePending: false
			});
			await recordKeyRevokedOp(ctx, {
				keyId: df.keyId,
				tx: simTxJson(rv.tx),
				now: opts.now,
				by: 'settlement',
				actor: lineUser.name
			});
		}
	};

	if (spec.stage === 'settled') {
		// Refund within seconds of the line settling.
		await settleOnce({ now: tReturn + (35 + Math.floor(w.rand() * 70)) * 1000, source: 'line' });
		return containerId;
	}

	// Disputed: the line posted damage, the importer disputed part of it inside the window.
	const damage = u(toUnits(spec.damage ?? '0'));
	await ctx.db.patch(containerId, {
		damageUnits: damage.toString(),
		chargeNote: spec.damageNote,
		chargesPostedAt: tReturn + 2 * HOUR_MS
	});
	await logEvent(
		ctx,
		containerId,
		'charges_posted',
		'Final charges posted',
		tReturn + 2 * HOUR_MS,
		`Damage ${formatUsd(damage)}: ${spec.damageNote ?? ''}`,
		lineUser.name
	);
	await notify(ctx, {
		orgId: spec.imp._id,
		kind: 'charges_posted',
		title: `Charges posted: ${number}`,
		body: `Damage ${formatUsd(damage)} (${spec.damageNote}). Accept or dispute before the window ends.`,
		containerId,
		at: tReturn + 2 * HOUR_MS
	});
	const d = spec.dispute!;
	await settleOnce({ now: d.at, source: 'dispute', disputed: toUnits(d.units).toString() });
	const rel = await ctx.db
		.query('relationships')
		.withIndex('by_pair', (q) => q.eq('lineOrgId', spec.line._id).eq('importerOrgId', spec.imp._id))
		.unique();
	if (rel) await ctx.db.patch(rel._id, { disputes: rel.disputes + 1 });
	return containerId;
}

/**
 * Live mode has no fake chain history: only the platform resolver org and its desk persona exist
 * so that new lines can name a resolver. Everything else is created through the product.
 */
async function seedLive(ctx: MutationCtx): Promise<void> {
	const T0 = Date.now();
	const platformId = await ctx.db.insert('organizations', {
		kind: 'platform',
		name: 'Portunus Resolution Desk',
		shortCode: 'PRTN',
		country: 'Global',
		blurb: 'Default dispute resolver for lines and importers who both agreed to it at onboarding.',
		createdAt: T0
	});
	await ctx.db.insert('users', {
		orgId: platformId,
		name: 'Resolution Desk',
		role: 'platform',
		title: 'Dispute resolver',
		demo: true,
		email: 'desk@portunus.example',
		createdAt: T0
	});
}

/** Public, idempotent: seeds the demo world if the database has no organizations. */
export const ensure = mutation({
	args: {},
	handler: async (ctx): Promise<{ seeded: boolean; containers?: number }> => {
		const existing = await ctx.db.query('organizations').first();
		if (existing) return { seeded: false };
		if (chainMode() === 'live') {
			await seedLive(ctx);
			return { seeded: true, containers: 0 };
		}
		const r = await seedWorld(ctx);
		return { seeded: true, containers: r.containers };
	}
});

/** Reseed unconditionally. Callers must have wiped the tables first (demo.reset does). */
export const run = internalMutation({
	args: {},
	handler: async (ctx): Promise<{ containers: number }> => seedWorld(ctx)
});
