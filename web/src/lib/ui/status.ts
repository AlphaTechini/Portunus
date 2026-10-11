/**
 * Container state system. One entry per state from details.md 14.2 plus
 * "pending on-chain" from 14.6. StatusPill reads this map; pages must not invent
 * their own colors or labels for these states.
 */
import type { Component } from 'svelte';
import CircleDashed from '@lucide/svelte/icons/circle-dashed';
import Hourglass from '@lucide/svelte/icons/hourglass';
import ShieldCheck from '@lucide/svelte/icons/shield-check';
import KeyRound from '@lucide/svelte/icons/key-round';
import DoorOpen from '@lucide/svelte/icons/door-open';
import Timer from '@lucide/svelte/icons/timer';
import AlarmClock from '@lucide/svelte/icons/alarm-clock';
import PackageCheck from '@lucide/svelte/icons/package-check';
import Scale from '@lucide/svelte/icons/scale';
import CircleCheck from '@lucide/svelte/icons/circle-check';
import Flag from '@lucide/svelte/icons/flag';
import Loader from '@lucide/svelte/icons/loader';

export type Tone = 'neutral' | 'protocol' | 'info' | 'success' | 'warning' | 'caution' | 'danger';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type IconComponent = Component<any>;

export const CONTAINER_STATES = [
	'requested',
	'awaiting_deposit',
	'deposit_held',
	'authorized',
	'released',
	'in_free_time',
	'in_detention',
	'returned',
	'settling',
	'settled',
	'disputed',
	'pending_onchain'
] as const;

export type ContainerState = (typeof CONTAINER_STATES)[number];

export interface StatusDef {
	/** Short label for pills and table cells. */
	label: string;
	/** Sentence-length label for headers and toasts. */
	long: string;
	/** One line of help text for tooltips and empty states. */
	description: string;
	tone: Tone;
	icon: IconComponent;
	/** True while the state is changing in real time (shows a pulsing dot). */
	live?: boolean;
}

export const STATUS: Record<ContainerState, StatusDef> = {
	requested: {
		label: 'Requested',
		long: 'Release requested',
		description: 'The line has created a release request. The importer has not acted yet.',
		tone: 'neutral',
		icon: CircleDashed
	},
	awaiting_deposit: {
		label: 'Awaiting deposit',
		long: 'Awaiting deposit',
		description: 'Release is blocked until each container is fully covered.',
		tone: 'warning',
		icon: Hourglass
	},
	deposit_held: {
		label: 'Deposit held',
		long: 'Deposit held by protocol',
		description:
			"The deposit has left the importer and sits in the protocol guard, not the line's balance.",
		tone: 'protocol',
		icon: ShieldCheck
	},
	authorized: {
		label: 'Authorized',
		long: 'Authorized, deposit-free',
		description:
			'An access key lets the line pull at most one day of detention per day. No money has moved.',
		tone: 'protocol',
		icon: KeyRound
	},
	released: {
		label: 'Released',
		long: 'Release order issued',
		description: 'The line has issued the release order. The container may leave the port.',
		tone: 'info',
		icon: DoorOpen
	},
	in_free_time: {
		label: 'In free time',
		long: 'In free time',
		description: 'No detention accrues until free time ends.',
		tone: 'success',
		icon: Timer,
		live: true
	},
	in_detention: {
		label: 'In detention',
		long: 'In detention',
		description: 'Free time has ended. Detention accrues daily, up to the deposit amount.',
		tone: 'caution',
		icon: AlarmClock,
		live: true
	},
	returned: {
		label: 'Returned',
		long: 'Empty returned',
		description: 'The return receipt is recorded. The settlement window is open.',
		tone: 'info',
		icon: PackageCheck
	},
	settling: {
		label: 'Settling',
		long: 'Settling',
		description:
			'Charges to the line and the refund to the importer are being sent in one transaction.',
		tone: 'protocol',
		icon: Scale,
		live: true
	},
	settled: {
		label: 'Settled',
		long: 'Settled and refunded',
		description: 'Charges paid to the line and the remainder refunded to the importer.',
		tone: 'success',
		icon: CircleCheck
	},
	disputed: {
		label: 'Disputed',
		long: 'Charges disputed',
		description: 'Disputed funds stay held. Undisputed funds settle immediately.',
		tone: 'danger',
		icon: Flag
	},
	pending_onchain: {
		label: 'Pending on-chain',
		long: 'Pending on-chain',
		description: 'Waiting for the network to confirm. Nothing is shown as paid until it is final.',
		tone: 'neutral',
		icon: Loader,
		live: true
	}
};

export function statusOf(state: ContainerState | string): StatusDef {
	return (
		STATUS[state as ContainerState] ?? {
			label: String(state),
			long: String(state),
			description: '',
			tone: 'neutral',
			icon: CircleDashed
		}
	);
}
