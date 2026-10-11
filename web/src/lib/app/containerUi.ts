/**
 * Small pieces of container presentation shared by the importer and container pages:
 * state groups for filters, mode labels, durations for refunds.
 */
import type { ContainerState } from '../ui/status';
import { formatDuration } from '../ui/format';

export type DepositMode = 'held' | 'depositFree';

export const MODE_LABEL: Record<DepositMode, string> = {
	held: 'Held deposit',
	depositFree: 'Deposit-free'
};

export type StateGroup =
	'all' | 'awaiting' | 'free_time' | 'detention' | 'returned' | 'settled' | 'disputed';

export const STATE_GROUPS: { value: StateGroup; label: string; states: ContainerState[] | null }[] =
	[
		{ value: 'all', label: 'All', states: null },
		{
			value: 'awaiting',
			label: 'Awaiting',
			states: ['requested', 'awaiting_deposit', 'deposit_held', 'authorized']
		},
		{ value: 'free_time', label: 'In free time', states: ['released', 'in_free_time'] },
		{ value: 'detention', label: 'In detention', states: ['in_detention'] },
		{ value: 'returned', label: 'Returned, settling', states: ['returned', 'settling'] },
		{ value: 'settled', label: 'Settled', states: ['settled'] },
		{ value: 'disputed', label: 'Disputed', states: ['disputed'] }
	];

export function inGroup(state: string, group: StateGroup): boolean {
	const g = STATE_GROUPS.find((x) => x.value === group);
	return !g?.states || g.states.includes(state as ContainerState);
}

/** "3.2 seconds", "480 ms", "2 minutes": time from return to refund, with seconds emphasised. */
export function formatRefundTime(ms: number): string {
	if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
	if (ms < 120_000) {
		const s = ms / 1000;
		return `${s < 10 ? s.toFixed(1) : Math.round(s)} seconds`;
	}
	return formatDuration(ms, 'long');
}

/** Number and unit apart, for big KPI figures: ["3.2", "seconds"]. */
export function splitRefundTime(ms: number): [string, string] {
	const t = formatRefundTime(ms);
	const i = t.indexOf(' ');
	return [t.slice(0, i), t.slice(i + 1)];
}
