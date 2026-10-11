/** Container state machine (ARCHITECTURE section 5). Keys are used verbatim by the UI StatusPill. */

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
	'disputed'
] as const;

export type ContainerState = (typeof CONTAINER_STATES)[number];

export const STATE_LABELS: Record<ContainerState, string> = {
	requested: 'Awaiting authorization',
	awaiting_deposit: 'Awaiting deposit',
	deposit_held: 'Deposit held by protocol',
	authorized: 'Authorized',
	released: 'Released',
	in_free_time: 'In free time',
	in_detention: 'In detention',
	returned: 'Returned',
	settling: 'Settling',
	settled: 'Settled',
	disputed: 'Disputed'
};

export const ALLOWED_TRANSITIONS: Record<ContainerState, readonly ContainerState[]> = {
	requested: ['authorized'],
	awaiting_deposit: ['deposit_held'],
	deposit_held: ['released'],
	authorized: ['released'],
	released: ['in_free_time'],
	in_free_time: ['in_detention', 'returned'],
	in_detention: ['returned'],
	// returned -> in_detention/in_free_time when the line contests an importer-submitted receipt
	returned: ['settling', 'in_detention', 'in_free_time'],
	// settling -> returned when the on-chain step failed and is rolled back
	settling: ['settled', 'disputed', 'returned'],
	settled: [],
	disputed: ['settled']
};

export function canTransition(from: ContainerState, to: ContainerState): boolean {
	return ALLOWED_TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends Error {
	constructor(
		public from: ContainerState,
		public to: ContainerState
	) {
		super(`Illegal container transition ${from} -> ${to}`);
		this.name = 'InvalidTransitionError';
	}
}

export function assertTransition(from: ContainerState, to: ContainerState): void {
	if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

/** States in which the container is out of the yard and the clock may be running. */
export const OUT_STATES: readonly ContainerState[] = ['released', 'in_free_time', 'in_detention'];
/** States in which the deposit/guarantee is in place and a release order may be issued. */
export const COVERED_STATES: readonly ContainerState[] = ['deposit_held', 'authorized'];
/** States in which a deposit or authorization is still owed. */
export const OPEN_STATES: readonly ContainerState[] = ['requested', 'awaiting_deposit'];
/** Terminal. */
export const CLOSED_STATES: readonly ContainerState[] = ['settled'];
