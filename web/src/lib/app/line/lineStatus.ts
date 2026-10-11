/** Small pure helpers shared by the shipping line pages. */
import type { ContainerState } from '#lib/ui';

/** The single status that best describes a request, from its containers' states. */
export function headlineState(byState: Record<string, number>): ContainerState {
	const has = (s: string) => (byState[s] ?? 0) > 0;
	const order: ContainerState[] = [
		'disputed',
		'awaiting_deposit',
		'requested',
		'deposit_held',
		'authorized',
		'in_detention',
		'in_free_time',
		'released',
		'settling',
		'returned',
		'settled'
	];
	for (const s of order) if (has(s)) return s;
	return 'requested';
}

/** "2 in free time, 1 in detention" from a state tally. */
export function stateSummary(byState: Record<string, number>): string {
	const labels: Record<string, string> = {
		requested: 'awaiting authorization',
		awaiting_deposit: 'awaiting deposit',
		deposit_held: 'deposit held',
		authorized: 'authorized',
		released: 'released',
		in_free_time: 'in free time',
		in_detention: 'in detention',
		returned: 'returned',
		settling: 'settling',
		settled: 'settled',
		disputed: 'disputed'
	};
	return Object.entries(byState)
		.filter(([, n]) => n > 0)
		.map(([s, n]) => `${n} ${labels[s] ?? s}`)
		.join(', ');
}

/** Value for an `<input type="datetime-local">` in the viewer's local time. */
export function toLocalInput(ms: number): string {
	const d = new Date(ms);
	const p = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fromLocalInput(value: string): number {
	return new Date(value).getTime();
}

/** Backend `Id` casts for route params. */
export function asId<T extends string>(value: string): T {
	return value as T;
}

/** Whole dollars (USD number) from base units, for charts only. */
export function unitsToUsd(value: string | bigint): number {
	const v = typeof value === 'bigint' ? value : BigInt(value || '0');
	return Number(v) / 1_000_000;
}

/** Parse a user-entered dollar amount like "1,250.5" to base units; null when invalid. */
export function parseUsdToUnits(input: string): bigint | null {
	const s = input.trim().replace(/[$,\s]/g, '');
	if (s === '') return 0n;
	if (!/^\d+(\.\d{0,6})?$/.test(s)) return null;
	const [whole, frac = ''] = s.split('.');
	return BigInt(whole) * 1_000_000n + BigInt(frac.padEnd(6, '0'));
}

/** Base units to a plain "1250.50" string for an input. */
export function unitsToInput(value: string | bigint): string {
	const v = typeof value === 'bigint' ? value : BigInt(value || '0');
	const whole = v / 1_000_000n;
	const frac = (v % 1_000_000n).toString().padStart(6, '0').slice(0, 2);
	return `${whole}.${frac}`;
}

import type { FunctionReturnType } from 'convex/server';
import type { api } from '../api';

/** A container as the line sees it (`containers.listForLine`). */
export type LineContainer = FunctionReturnType<typeof api.containers.listForLine>[number];
