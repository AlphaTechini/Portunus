/**
 * Registry of Tempo protocol features named on screen (demo-video.md chapter 3).
 * TempoTag reads this. Only TIP numbers stated in details.md are used; do not invent others.
 */

export const TEMPO_NETWORK = {
	name: 'Tempo Moderato testnet',
	short: 'Moderato testnet'
} as const;

export interface TempoFeature {
	/** The on-screen label. Keep it short and literal. */
	label: string;
	/** Protocol reference, e.g. "TIP-1022". Omit if details.md gives none. */
	tip?: string;
	/** Tooltip title. */
	title: string;
	/** Tooltip body: what the protocol does here, in plain words. */
	description: string;
	/** Docs link (details.md section 15). */
	href?: string;
}

export const TEMPO_FEATURES = {
	virtual_address: {
		label: 'Virtual address per container',
		tip: 'TIP-1022',
		title: 'Virtual addresses',
		description:
			"Each container gets its own deposit address, derived from the line's deposits account. Payments land already matched to the container, with no setup cost.",
		href: 'https://tempo.xyz/developers/docs/guide/payments/virtual-addresses'
	},
	receive_policy: {
		label: "Receive policy: funds in the protocol guard, not the line's balance",
		tip: 'TIP-1028',
		title: 'Receive policies and the protocol guard',
		description:
			"The line's deposits account does not accept deposits into its balance. Funds sit in the protocol guard, recoverable only by the settlement contract.",
		href: 'https://tempo.xyz/blog/receive-policies/'
	},
	held_not_lost: {
		label: 'Held, not lost',
		tip: 'TIP-1028',
		title: 'Held by the protocol guard',
		description:
			'Wrong tokens and payments from unknown senders are held by the guard and returned through the settlement contract. They are never lost.',
		href: 'https://tempo.xyz/blog/receive-policies/'
	},
	recovery_authority: {
		label: 'Settlement contract = recovery authority',
		tip: 'TIP-1028',
		title: 'Settlement contract as recovery authority',
		description:
			'The only party that can release funds from the guard. It can pay exactly two places: the line, for approved charges, or the original payer, as a refund.',
		href: 'https://github.com/emilbob/held'
	},
	access_key: {
		label: 'Access key',
		title: 'Access keys with spending limits',
		description:
			"A key on the importer's own account, held by the line: one token, a daily cap, payable only to the line's charges address, with an expiry. No money moves until a charge is owed.",
		href: 'https://v3.viem.sh/tempo/guides/access-keys/permissions'
	},
	recurring_limit: {
		label: 'Recurring limit enforced by the protocol, not by our app',
		title: 'Recurring spending limit',
		description:
			'The access key resets daily. A second pull on the same day is refused by the chain itself.',
		href: 'https://tempo.xyz/blog/subscriptions-on-tempo/'
	},
	key_revoked: {
		label: 'Access key revoked',
		title: 'Key revocation',
		description:
			'When the empty is returned and settled, the deposit-free key is revoked on-chain.',
		href: 'https://v3.viem.sh/tempo/guides/access-keys/permissions'
	},
	memo: {
		label: 'Memo: container and B/L number',
		tip: 'TIP-20',
		title: 'Transfers with memos',
		description:
			'Every deposit, charge and refund carries the container number, bill of lading and return receipt in its memo, so both sides read the same record.'
	},
	batch: {
		label: 'Batch transaction',
		title: 'Batch transactions',
		description:
			'All containers on one bill of lading are paid in one all-or-nothing transaction. Lines settle many returns at once.'
	},
	fee_sponsored: {
		label: 'Fee sponsored, no gas',
		title: 'Fee sponsorship',
		description:
			'Portunus pays the network fee. Importers, clearing agents and line staff never need to hold gas.'
	},
	passkey: {
		label: 'Passkey',
		title: 'Passkeys',
		description:
			'Sign in and approve with Face ID, a fingerprint or your device PIN. No seed phrases.'
	},
	finality: {
		label: 'Final in about 0.5 s',
		title: 'Deterministic finality',
		description:
			'A transaction is final in about half a second and cannot be reversed. The line can issue the release order on the spot.'
	},
	refund_seconds: {
		label: 'Refund in seconds',
		title: 'Settlement from the guard',
		description:
			'Charges to the line and the remainder to the importer go out in one transaction, straight from the guard.'
	}
} as const satisfies Record<string, TempoFeature>;

export type TempoFeatureKey = keyof typeof TEMPO_FEATURES;

/** Sentence used in every TempoTag tooltip footer. Wording from demo-video.md rules. */
export const TEMPO_PROTOCOL_NOTE =
	'On Tempo this is part of the protocol; elsewhere it would be custom contract code.';
