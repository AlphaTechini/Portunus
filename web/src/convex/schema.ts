import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

// Literal unions are spelled out so `Doc<...>` types stay precise.
// Keep in sync with src/lib/shared/domain/states.ts.
export const containerState = v.union(
	v.literal('requested'),
	v.literal('awaiting_deposit'),
	v.literal('deposit_held'),
	v.literal('authorized'),
	v.literal('released'),
	v.literal('in_free_time'),
	v.literal('in_detention'),
	v.literal('returned'),
	v.literal('settling'),
	v.literal('settled'),
	v.literal('disputed')
);

export const containerType = v.union(
	v.literal('20GP'),
	v.literal('40GP'),
	v.literal('40HC'),
	v.literal('20RF'),
	v.literal('40RF')
);

export const depositMode = v.union(v.literal('held'), v.literal('depositFree'));
export const orgKind = v.union(v.literal('line'), v.literal('importer'), v.literal('platform'));
export const userRole = orgKind;
export const chainMode = v.union(v.literal('sim'), v.literal('live'));

export const paymentKind = v.union(
	v.literal('deposit'),
	v.literal('detention_pull'),
	v.literal('charge'),
	v.literal('refund'),
	v.literal('held_transfer'),
	v.literal('held_return'),
	v.literal('key_authorized'),
	v.literal('key_revoked'),
	v.literal('dispute_release')
);

export default defineSchema({
	organizations: defineTable({
		kind: orgKind,
		name: v.string(),
		shortCode: v.string(),
		country: v.string(),
		tempoAddress: v.optional(v.string()),
		// line only
		depositsAccount: v.optional(v.string()),
		chargesAddress: v.optional(v.string()),
		settlementContract: v.optional(v.string()),
		masterId: v.optional(v.string()),
		receivePolicy: v.optional(
			v.object({
				senderPolicy: v.string(),
				tokenPolicy: v.string(),
				recoveryAuthority: v.string(),
				configuredAt: v.number()
			})
		),
		settlementWindowDays: v.optional(v.number()),
		cleanReturnsForDepositFree: v.optional(v.number()),
		maxDetentionDays: v.optional(v.number()),
		silentGraceHours: v.optional(v.number()),
		resolverOrgId: v.optional(v.id('organizations')),
		/** Per-line counter feeding the virtual address user tag. */
		nextSeq: v.optional(v.number()),
		/** Owner prefix for generated container numbers (seeds), e.g. MRDU. */
		containerPrefix: v.optional(v.string()),
		/** Index of the line among sim lines (picks the fake master id). */
		simIndex: v.optional(v.number()),
		blurb: v.optional(v.string()),
		/** Live indexer cursor: last block scanned for guard receipts. */
		lastIndexedBlock: v.optional(v.string()),
		createdAt: v.optional(v.number())
	})
		.index('by_kind', ['kind'])
		.index('by_short_code', ['shortCode']),

	users: defineTable({
		orgId: v.id('organizations'),
		name: v.string(),
		email: v.optional(v.string()),
		role: userRole,
		title: v.optional(v.string()),
		demo: v.boolean(),
		blurb: v.optional(v.string()),
		credentialId: v.optional(v.string()),
		passkey: v.optional(
			v.object({
				credentialId: v.string(),
				publicKey: v.string(),
				address: v.string()
			})
		),
		createdAt: v.optional(v.number())
	})
		.index('by_org', ['orgId'])
		.index('by_credential', ['credentialId'])
		.index('by_demo', ['demo']),

	sessions: defineTable({
		token: v.string(),
		userId: v.id('users'),
		createdAt: v.number(),
		expiresAt: v.number(),
		approvedWith: v.optional(v.union(v.literal('passkey'), v.literal('demo'))),
		verified: v.optional(v.boolean())
	})
		.index('by_token', ['token'])
		.index('by_user', ['userId']),

	challenges: defineTable({
		challenge: v.string(),
		createdAt: v.number(),
		used: v.boolean()
	}).index('by_challenge', ['challenge']),

	rateCards: defineTable({
		lineOrgId: v.id('organizations'),
		containerType,
		freeDays: v.number(),
		dailyRateUnits: v.string(),
		depositUnits: v.string()
	})
		.index('by_line', ['lineOrgId'])
		.index('by_line_type', ['lineOrgId', 'containerType']),

	relationships: defineTable({
		lineOrgId: v.id('organizations'),
		importerOrgId: v.id('organizations'),
		defaultMode: depositMode,
		cleanReturns: v.number(),
		lateReturns: v.number(),
		disputes: v.number(),
		resolverOrgId: v.id('organizations')
	})
		.index('by_line', ['lineOrgId'])
		.index('by_importer', ['importerOrgId'])
		.index('by_pair', ['lineOrgId', 'importerOrgId']),

	releaseRequests: defineTable({
		lineOrgId: v.id('organizations'),
		importerOrgId: v.id('organizations'),
		billOfLading: v.string(),
		vessel: v.optional(v.string()),
		voyage: v.optional(v.string()),
		portOfDischarge: v.string(),
		mode: depositMode,
		status: v.union(
			v.literal('awaiting_importer'),
			v.literal('active'),
			v.literal('completed'),
			v.literal('cancelled')
		),
		createdBy: v.id('users'),
		createdAt: v.number(),
		requestCode: v.string()
	})
		.index('by_line', ['lineOrgId'])
		.index('by_importer', ['importerOrgId'])
		.index('by_code', ['requestCode']),

	containers: defineTable({
		requestId: v.id('releaseRequests'),
		lineOrgId: v.id('organizations'),
		importerOrgId: v.id('organizations'),
		number: v.string(),
		type: containerType,
		mode: depositMode,
		seq: v.number(),
		depositAddress: v.string(),
		depositUnits: v.string(),
		dailyRateUnits: v.string(),
		freeDays: v.number(),
		maxDetentionDays: v.number(),
		state: containerState,
		stateChangedAt: v.number(),
		createdAt: v.optional(v.number()),
		/** Sum of confirmed deposit receipts (held mode). */
		receivedUnits: v.optional(v.string()),
		releasedAt: v.optional(v.number()),
		freeTimeEndsAt: v.optional(v.number()),
		returnedAt: v.optional(v.number()),
		returnReceipt: v.optional(
			v.object({
				eirNumber: v.string(),
				date: v.number(),
				depot: v.string(),
				submittedBy: v.union(v.literal('line'), v.literal('importer')),
				recordedAt: v.number(),
				contested: v.optional(v.boolean())
			})
		),
		settlementWindowEndsAt: v.optional(v.number()),
		/** Detention days already processed (accrued / pulled). Exactly once each. */
		detentionDays: v.number(),
		accruedUnits: v.string(),
		pulledUnits: v.string(),
		chargesUnits: v.optional(v.string()),
		damageUnits: v.optional(v.string()),
		chargeNote: v.optional(v.string()),
		chargesPostedAt: v.optional(v.number()),
		refundUnits: v.optional(v.string()),
		settledAt: v.optional(v.number()),
		heldReceiptId: v.optional(v.string()),
		accessKeyId: v.optional(v.id('accessKeys')),
		disputeId: v.optional(v.id('disputes')),
		pendingOnChain: v.optional(
			v.object({
				step: v.string(),
				since: v.number(),
				attempts: v.number(),
				lastError: v.optional(v.string())
			})
		),
		scheduledJobId: v.optional(v.string())
	})
		.index('by_request', ['requestId'])
		.index('by_line', ['lineOrgId'])
		.index('by_importer', ['importerOrgId'])
		.index('by_line_state', ['lineOrgId', 'state'])
		.index('by_importer_state', ['importerOrgId', 'state'])
		.index('by_state', ['state'])
		.index('by_number', ['number'])
		.index('by_deposit_address', ['depositAddress']),

	payments: defineTable({
		kind: paymentKind,
		mode: chainMode,
		containerId: v.optional(v.id('containers')),
		requestId: v.optional(v.id('releaseRequests')),
		lineOrgId: v.optional(v.id('organizations')),
		importerOrgId: v.optional(v.id('organizations')),
		from: v.string(),
		to: v.string(),
		token: v.string(),
		amountUnits: v.string(),
		memo: v.string(),
		memoHex: v.string(),
		txHash: v.string(),
		logIndex: v.optional(v.number()),
		blockNumber: v.optional(v.string()),
		finalityMs: v.number(),
		timestamp: v.number(),
		status: v.union(v.literal('pending'), v.literal('confirmed'), v.literal('failed')),
		error: v.optional(v.string()),
		/** Detention day for pulls. */
		day: v.optional(v.number()),
		/** Guard receipt this payment created or consumed (deposit / charge / refund). */
		receiptId: v.optional(v.string()),
		receipt: v.optional(v.string()),
		approvedWith: v.optional(v.union(v.literal('passkey'), v.literal('demo')))
	})
		.index('by_container', ['containerId'])
		.index('by_request', ['requestId'])
		.index('by_line', ['lineOrgId'])
		.index('by_importer', ['importerOrgId'])
		.index('by_tx', ['txHash']),

	accessKeys: defineTable({
		containerId: v.id('containers'),
		account: v.string(),
		keyAddress: v.string(),
		/** Server only. Never returned by public queries. */
		encPrivKey: v.string(),
		token: v.string(),
		dailyLimitUnits: v.string(),
		periodSec: v.number(),
		recipient: v.string(),
		expiry: v.number(),
		preparedAt: v.optional(v.number()),
		authorizedAt: v.optional(v.number()),
		revokedAt: v.optional(v.number()),
		/** Live: settlement is done, the importer is asked to revoke with their passkey. */
		revokeRequestedAt: v.optional(v.number()),
		status: v.union(v.literal('prepared'), v.literal('active'), v.literal('revoked')),
		/** Set when a pull found the key unusable (revoked early, expired, wrong scope). */
		unusableReason: v.optional(v.string()),
		expiryWarned: v.optional(v.boolean()),
		authorizeTxHash: v.optional(v.string()),
		mode: chainMode
	})
		.index('by_container', ['containerId'])
		.index('by_key', ['keyAddress']),

	heldTransfers: defineTable({
		lineOrgId: v.id('organizations'),
		receiptId: v.string(),
		receipt: v.string(),
		token: v.string(),
		tokenSymbol: v.string(),
		amountUnits: v.string(),
		originator: v.string(),
		recipient: v.string(),
		memo: v.string(),
		blockedAt: v.number(),
		reason: v.union(v.literal('unknown_sender'), v.literal('wrong_token'), v.literal('excess')),
		status: v.union(v.literal('held'), v.literal('returned'), v.literal('matched')),
		returnedTxHash: v.optional(v.string()),
		returnedAt: v.optional(v.number()),
		containerId: v.optional(v.id('containers')),
		txHash: v.optional(v.string()),
		mode: v.optional(chainMode)
	})
		.index('by_line_status', ['lineOrgId', 'status'])
		.index('by_receipt', ['receiptId']),

	disputes: defineTable({
		containerId: v.id('containers'),
		openedBy: v.id('users'),
		importerOrgId: v.id('organizations'),
		lineOrgId: v.id('organizations'),
		disputedUnits: v.string(),
		reason: v.string(),
		evidence: v.optional(v.string()),
		status: v.union(v.literal('open'), v.literal('resolved')),
		resolverOrgId: v.id('organizations'),
		/** Escrow held by the settlement contract, per guard receipt. */
		receiptEscrows: v.optional(
			v.array(v.object({ receiptId: v.string(), receipt: v.string(), escrowUnits: v.string() }))
		),
		decision: v.optional(
			v.object({
				toLineUnits: v.string(),
				toImporterUnits: v.string(),
				note: v.string(),
				decidedAt: v.number(),
				decidedBy: v.id('users')
			})
		),
		openedAt: v.number()
	})
		.index('by_container', ['containerId'])
		.index('by_line_status', ['lineOrgId', 'status'])
		.index('by_importer_status', ['importerOrgId', 'status'])
		.index('by_resolver_status', ['resolverOrgId', 'status']),

	notifications: defineTable({
		orgId: v.id('organizations'),
		userId: v.optional(v.id('users')),
		kind: v.string(),
		title: v.string(),
		body: v.string(),
		containerId: v.optional(v.id('containers')),
		createdAt: v.number(),
		readAt: v.optional(v.number())
	}).index('by_org', ['orgId']),

	jobRuns: defineTable({
		kind: v.string(),
		containerId: v.optional(v.id('containers')),
		scheduledFor: v.number(),
		ranAt: v.optional(v.number()),
		ok: v.optional(v.boolean()),
		error: v.optional(v.string())
	})
		.index('by_kind', ['kind', 'scheduledFor'])
		.index('by_container', ['containerId']),

	/** Human readable lifecycle timeline shown on the container detail page. */
	containerEvents: defineTable({
		containerId: v.id('containers'),
		kind: v.string(),
		title: v.string(),
		detail: v.optional(v.string()),
		at: v.number(),
		actor: v.optional(v.string())
	}).index('by_container', ['containerId']),

	// --- simulated chain (brief section 11) ---------------------------------
	sim_balances: defineTable({
		address: v.string(),
		token: v.string(),
		amount: v.string()
	}).index('by_address_token', ['address', 'token']),

	sim_keys: defineTable({
		account: v.string(),
		keyId: v.string(),
		token: v.string(),
		max: v.string(),
		remaining: v.string(),
		period: v.number(),
		periodEnd: v.number(),
		expiry: v.number(),
		recipients: v.array(v.string()),
		selector: v.literal('transferWithMemo'),
		revoked: v.boolean(),
		authorizedAt: v.number()
	}).index('by_account_key', ['account', 'keyId']),

	sim_receipts: defineTable({
		id: v.string(),
		receipt: v.string(),
		token: v.string(),
		amount: v.string(),
		originator: v.string(),
		recipient: v.string(),
		master: v.string(),
		blockedAt: v.number(),
		blockedNonce: v.number(),
		memo: v.string(),
		blockedReason: v.union(v.literal('tokenFilter'), v.literal('receivePolicy')),
		txHash: v.string(),
		logIndex: v.number(),
		status: v.union(v.literal('held'), v.literal('settled'), v.literal('disputed'), v.literal('returned')),
		escrow: v.string(),
		charged: v.string(),
		refunded: v.string(),
		settleTxHash: v.optional(v.string())
	})
		.index('by_receipt_id', ['id'])
		.index('by_master', ['master']),

	sim_events: defineTable({
		txHash: v.string(),
		logIndex: v.number(),
		name: v.string(),
		args: v.any(),
		blockNumber: v.number(),
		timestamp: v.number()
	}).index('by_tx', ['txHash', 'logIndex']),

	sim_masters: defineTable({
		masterId: v.string(),
		account: v.string(),
		settlement: v.string(),
		charges: v.string(),
		resolver: v.string(),
		token: v.string()
	})
		.index('by_account', ['account'])
		.index('by_master_id', ['masterId']),

	sim_meta: defineTable({
		seq: v.number(),
		block: v.number(),
		blockedNonce: v.number(),
		clockOffsetMs: v.number(),
		envPrefix: v.number()
	})
});
