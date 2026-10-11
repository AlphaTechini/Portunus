/**
 * Demo actions (simulated chain only). `DemoControls` uses these, and container pages use the same
 * hook for their own buttons ("Jump to end of free time", "Try a second pull").
 *
 *   const demo = useDemoActions();
 *   <Button loading={demo.busy === 'jump'} onclick={() => demo.jumpToFreeTimeEnd(container._id)}>
 *     Jump to end of free time
 *   </Button>
 *
 * Every method toasts its own outcome and errors; it resolves with the backend result, or `null`
 * when it failed. Call `useDemoActions()` during component initialisation.
 */
import { goto } from '$app/navigation';
import { toast, formatDuration } from '#lib/ui';
import { backendMode, clearSession, resetLocalDb, useAuthedAction } from '#lib/backend';
import { api } from './api';
import { useApp } from './ctx.svelte';
import { errorMessage } from './errors';

export type DemoBusy = null | 'advance' | 'jump' | 'second' | 'stranger' | 'reset';

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;

export function useDemoActions() {
	const app = useApp();
	const advance = useAuthedAction(api.demo.advanceClock);
	const jump = useAuthedAction(api.demo.jumpToFreeTimeEnd);
	const second = useAuthedAction(api.demo.trySecondPull);
	const stranger = useAuthedAction(api.demo.sendStrangerTransfer);
	const resetRemote = useAuthedAction(api.demo.reset);
	let busy = $state<DemoBusy>(null);

	async function run<T>(kind: Exclude<DemoBusy, null>, fn: () => Promise<T>): Promise<T | null> {
		if (busy) return null;
		busy = kind;
		try {
			return await fn();
		} catch (e) {
			toast.error('Demo action failed', { description: errorMessage(e) });
			return null;
		} finally {
			busy = null;
		}
	}

	return {
		/** Which action is running, for button `loading` states. */
		get busy(): DemoBusy {
			return busy;
		},

		/** Move the product clock forward and run every step that became due. */
		advanceClock: (ms: number) =>
			run('advance', async () => {
				const r = await advance({ ms });
				const s = r.sweep;
				const bits = [
					s.detentionDaysProcessed ? `${s.detentionDaysProcessed} detention day(s) processed` : '',
					s.settled ? `${s.settled} settled` : '',
					s.warned ? `${s.warned} warning(s) sent` : ''
				].filter(Boolean);
				toast.show(`Clock moved forward ${formatDuration(ms, 'long')}`, {
					description: bits.length ? bits.join(', ') : 'Nothing was due yet.'
				});
				return r;
			}),

		/** Jump the clock to one second after this container's free time ends. */
		jumpToFreeTimeEnd: (containerId: string) =>
			run('jump', async () => {
				const r = await jump({ containerId: containerId as never });
				toast.show('Free time has ended', {
					description: 'Detention starts now for this container.'
				});
				return r;
			}),

		/**
		 * Line tries a second detention pull on the same day. Resolves with the result; a refusal
		 * (`refused: true`) is the point of the demo, the chain's recurring limit said no.
		 */
		trySecondPull: (containerId: string) =>
			run('second', async () => {
				const r = await second({ containerId: containerId as never });
				if (r.refused) {
					toast.error('Refused by the chain', {
						description: 'SpendingLimitExceeded: the 1-day limit on the access key held.'
					});
				} else {
					toast.warning('The extra pull went through', { description: `Day ${r.day}.` });
				}
				return r;
			}),

		/** A stranger pays the current line: wrong token (BetaUSD) or unknown sender (AlphaUSD). */
		sendStranger: (token: 'BetaUSD' | 'AlphaUSD') =>
			run('stranger', async () => {
				if (app.role !== 'line') {
					toast.warning('Switch to a shipping line first', {
						description: 'Stranger transfers are sent to the current line.'
					});
					return null;
				}
				const r = await stranger({ lineOrgId: app.org._id, token });
				const wrong = token === 'BetaUSD';
				toast.warning('Held by the guard, not lost', {
					description: wrong
						? 'A payment in the wrong token is waiting under Held transfers.'
						: 'A payment from an unknown sender is waiting under Held transfers.',
					txHash: app.displayHash(r.txHash),
					action: { label: 'Open held transfers', onClick: () => void goto('/line/held') }
				});
				return r;
			}),

		/** Wipe and reseed the demo world, sign out, go to /signin. */
		reset: () =>
			run('reset', async () => {
				app.signingOut = true;
				try {
					if (backendMode === 'local') await resetLocalDb();
					else {
						await resetRemote({});
						clearSession();
					}
					toast.success('Demo data reset', { description: 'Pick a persona to start again.' });
					await goto('/signin');
				} finally {
					app.signingOut = false;
				}
				return true;
			})
	};
}

// ---------------------------------------------------------------------------------------------
// Page-specific actions in the floating panel
// ---------------------------------------------------------------------------------------------

export interface DemoPageAction {
	id: string;
	label: string;
	/** Second line under the label. */
	hint?: string;
	onclick: () => void | Promise<unknown>;
	busy?: boolean;
	disabled?: boolean;
}

let pageActions = $state.raw<DemoPageAction[]>([]);

/** What DemoControls shows under "On this page". */
export function getDemoPageActions(): DemoPageAction[] {
	return pageActions;
}

/**
 * Add actions to the demo panel while the calling page is mounted. Pass a getter so labels and
 * busy flags stay reactive:
 *
 *   useDemoPageActions(() => [
 *     { id: 'jump', label: 'Jump to end of free time', busy: demo.busy === 'jump',
 *       onclick: () => demo.jumpToFreeTimeEnd(container._id) }
 *   ]);
 */
export function useDemoPageActions(actions: () => DemoPageAction[]) {
	$effect(() => {
		const mine = actions();
		pageActions = mine;
		return () => {
			if (pageActions === mine) pageActions = [];
		};
	});
}
