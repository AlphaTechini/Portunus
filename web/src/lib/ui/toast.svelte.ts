/**
 * Toast queue. Usage:
 *   import { toast } from '#lib/ui/toast.svelte';
 *   toast.success('Deposit held by protocol', { description: 'Final in 482 ms', txHash });
 * Render <Toaster /> once in the root layout.
 */
import type { Tone } from './status';

export interface ToastAction {
	label: string;
	onClick: () => void;
}

export interface ToastOptions {
	description?: string;
	/** Shown as a truncated hash with copy; links to href if given. */
	txHash?: string;
	href?: string;
	/** Finality in ms, shown as "Final in 482 ms". */
	finalityMs?: number;
	action?: ToastAction;
	/** ms; 0 = sticky. Default 5000 (errors 8000). */
	duration?: number;
}

export interface ToastItem extends ToastOptions {
	id: number;
	title: string;
	tone: Extract<Tone, 'neutral' | 'success' | 'danger' | 'warning' | 'protocol'>;
}

let nextId = 1;

class ToastStore {
	items: ToastItem[] = $state([]);
	#timers = new Map<number, ReturnType<typeof setTimeout>>();

	push(title: string, tone: ToastItem['tone'], opts: ToastOptions = {}): number {
		const id = nextId++;
		this.items = [...this.items, { id, title, tone, ...opts }].slice(-4);
		const duration = opts.duration ?? (tone === 'danger' ? 8000 : 5000);
		if (duration > 0 && typeof window !== 'undefined') {
			this.#timers.set(
				id,
				setTimeout(() => this.dismiss(id), duration)
			);
		}
		return id;
	}

	dismiss(id: number) {
		clearTimeout(this.#timers.get(id));
		this.#timers.delete(id);
		this.items = this.items.filter((t) => t.id !== id);
	}

	/** Pause auto-dismiss (hover / focus). */
	hold(id: number) {
		clearTimeout(this.#timers.get(id));
		this.#timers.delete(id);
	}

	release(id: number, ms = 2500) {
		if (!this.items.some((t) => t.id === id)) return;
		this.#timers.set(
			id,
			setTimeout(() => this.dismiss(id), ms)
		);
	}

	show = (title: string, opts?: ToastOptions) => this.push(title, 'neutral', opts);
	success = (title: string, opts?: ToastOptions) => this.push(title, 'success', opts);
	error = (title: string, opts?: ToastOptions) => this.push(title, 'danger', opts);
	warning = (title: string, opts?: ToastOptions) => this.push(title, 'warning', opts);
	/** A protocol event landed: deposit held, key authorized, settlement final. */
	protocol = (title: string, opts?: ToastOptions) => this.push(title, 'protocol', opts);
}

export const toast = new ToastStore();
