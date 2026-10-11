/**
 * Schedule math for `cronJobs()` definitions (`crons.crons[id].schedule`).
 * All times are UTC, like Convex.
 */

export type CronSchedule =
	| { type: 'interval'; seconds?: number; minutes?: number; hours?: number }
	| { type: 'hourly'; minuteUTC?: number }
	| { type: 'daily'; hourUTC: number; minuteUTC?: number }
	| { type: 'weekly'; dayOfWeek: string; hourUTC: number; minuteUTC?: number }
	| { type: 'monthly'; day: number; hourUTC: number; minuteUTC?: number }
	| { type: 'cron'; cron: string };

export interface CronSpec {
	name: string;
	args: unknown[];
	schedule: CronSchedule;
}

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MINUTE = 60_000;

function parseField(field: string, min: number, max: number): Set<number> {
	const out = new Set<number>();
	for (const part of field.split(',')) {
		const [rangePart, stepPart] = part.split('/');
		const step = stepPart ? parseInt(stepPart, 10) : 1;
		let lo = min;
		let hi = max;
		if (rangePart !== '*') {
			const [a, b] = rangePart.split('-');
			lo = parseInt(a, 10);
			hi = b !== undefined ? parseInt(b, 10) : stepPart ? max : lo;
		}
		if (Number.isNaN(lo) || Number.isNaN(hi) || Number.isNaN(step) || step < 1) {
			throw new Error(`Invalid cron field: ${field}`);
		}
		for (let i = lo; i <= hi; i += step) out.add(i);
	}
	return out;
}

/** Next minute strictly after `after` matching a 5-field cron expression (UTC). */
function nextCronExpr(expr: string, after: number): number {
	const parts = expr.trim().split(/\s+/);
	if (parts.length !== 5) throw new Error(`Unsupported cron expression: ${expr}`);
	const mins = parseField(parts[0], 0, 59);
	const hours = parseField(parts[1], 0, 23);
	const doms = parseField(parts[2], 1, 31);
	const months = parseField(parts[3], 1, 12);
	const dows = parseField(parts[4].replace(/7/g, '0'), 0, 6);
	const domStar = parts[2] === '*';
	const dowStar = parts[4] === '*';
	let t = Math.floor(after / MINUTE) * MINUTE + MINUTE;
	const limit = after + 366 * 24 * 60 * MINUTE;
	while (t <= limit) {
		const d = new Date(t);
		if (!months.has(d.getUTCMonth() + 1)) {
			t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
			continue;
		}
		const domOk = doms.has(d.getUTCDate());
		const dowOk = dows.has(d.getUTCDay());
		const dayOk = domStar && dowStar ? true : domStar ? dowOk : dowStar ? domOk : domOk || dowOk;
		if (!dayOk) {
			t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
			continue;
		}
		if (!hours.has(d.getUTCHours())) {
			t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours() + 1);
			continue;
		}
		if (!mins.has(d.getUTCMinutes())) {
			t += MINUTE;
			continue;
		}
		return t;
	}
	return Infinity;
}

/** The first firing time strictly after `after`. */
export function nextRun(s: CronSchedule, after: number): number {
	switch (s.type) {
		case 'interval': {
			const ms = (s.seconds ?? 0) * 1000 + (s.minutes ?? 0) * MINUTE + (s.hours ?? 0) * 60 * MINUTE;
			return after + ms;
		}
		case 'hourly': {
			const m = s.minuteUTC ?? 0;
			const d = new Date(after);
			let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), m);
			if (t <= after) t += 60 * MINUTE;
			return t;
		}
		case 'daily': {
			const d = new Date(after);
			let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), s.hourUTC, s.minuteUTC ?? 0);
			if (t <= after) t += 24 * 60 * MINUTE;
			return t;
		}
		case 'weekly': {
			const dow = DAYS.indexOf(String(s.dayOfWeek).toLowerCase());
			const d = new Date(after);
			let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), s.hourUTC, s.minuteUTC ?? 0);
			t += ((dow - new Date(t).getUTCDay() + 7) % 7) * 24 * 60 * MINUTE;
			if (t <= after) t += 7 * 24 * 60 * MINUTE;
			return t;
		}
		case 'monthly': {
			const d = new Date(after);
			const at = (y: number, mo: number) => {
				const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
				return Date.UTC(y, mo, Math.min(s.day, last), s.hourUTC, s.minuteUTC ?? 0);
			};
			let t = at(d.getUTCFullYear(), d.getUTCMonth());
			if (t <= after) t = at(d.getUTCFullYear(), d.getUTCMonth() + 1);
			return t;
		}
		case 'cron':
			return nextCronExpr(s.cron, after);
		default:
			return Infinity;
	}
}
