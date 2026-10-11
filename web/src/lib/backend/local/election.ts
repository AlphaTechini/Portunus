/**
 * Leader election between tabs. Exactly one tab (the leader) executes mutations, actions,
 * scheduled functions and crons; others forward writes to it and replicate its commits.
 *
 *  - Preferred: `navigator.locks` (the lock is held for the lifetime of the tab, released
 *    automatically when the tab closes or crashes).
 *  - Fallback: a localStorage heartbeat lease.
 */
import type { StorageLike } from './platform.js';

export interface LocksLike {
	request(
		name: string,
		optionsOrCb: { ifAvailable?: boolean } | ((lock: unknown) => unknown),
		cb?: (lock: unknown) => unknown
	): Promise<unknown>;
}

export interface Election {
	/** Resolves once we know whether this tab started as the leader. */
	initial: Promise<boolean>;
	/** Give up leadership / stop competing (tab closing, tests simulating a crash). */
	stop(): void;
}

export interface ElectionOptions {
	name: string;
	tabId: string;
	locks?: LocksLike | null;
	storage?: StorageLike | null;
	/** Called when a tab that started as a follower becomes the leader. */
	onLeader: () => void;
}

export function startElection(o: ElectionOptions): Election {
	if (o.locks) return lockElection(o, o.locks);
	if (o.storage) return heartbeatElection(o, o.storage);
	return { initial: Promise.resolve(true), stop() {} };
}

function lockElection(o: ElectionOptions, locks: LocksLike): Election {
	let releaseHeld: (() => void) | null = null;
	let stopped = false;
	const hold = () =>
		new Promise<void>((resolve) => {
			releaseHeld = resolve;
		});
	const initial = new Promise<boolean>((resolve) => {
		void locks.request(o.name, { ifAvailable: true }, (lock) => {
			if (!lock) {
				resolve(false);
				// Queue for takeover when the current leader goes away.
				void locks.request(o.name, () => {
					if (stopped) return undefined;
					o.onLeader();
					return hold();
				});
				return undefined;
			}
			resolve(true);
			return hold();
		});
	});
	return {
		initial,
		stop() {
			stopped = true;
			releaseHeld?.();
		}
	};
}

const LEASE_MS = 4000;
const BEAT_MS = 1500;

function heartbeatElection(o: ElectionOptions, storage: StorageLike): Election {
	const key = `${o.name}.leader`;
	let leader = false;
	let stopped = false;
	let timer: ReturnType<typeof setInterval> | null = null;

	const read = (): { id: string; ts: number } | null => {
		try {
			const raw = storage.getItem(key);
			return raw ? JSON.parse(raw) : null;
		} catch {
			return null;
		}
	};
	const write = () => {
		try {
			storage.setItem(key, JSON.stringify({ id: o.tabId, ts: Date.now() }));
		} catch {
			/* ignore */
		}
	};
	const free = (cur: { id: string; ts: number } | null) =>
		!cur || cur.id === o.tabId || Date.now() - cur.ts > LEASE_MS;

	let announced = false;
	const tryClaim = async (): Promise<boolean> => {
		if (!free(read())) return false;
		write();
		await new Promise((r) => setTimeout(r, 40));
		return read()?.id === o.tabId;
	};

	const initial = tryClaim().then((got) => {
		leader = got;
		announced = got;
		timer = setInterval(async () => {
			if (stopped) return;
			if (leader) {
				if (read()?.id === o.tabId) write();
				else leader = false; // lost the lease (clock skew or split brain)
			} else if (await tryClaim()) {
				leader = true;
				if (!announced) {
					announced = true;
					o.onLeader();
				}
			}
		}, BEAT_MS);
		return got;
	});

	return {
		initial,
		stop() {
			stopped = true;
			if (timer) clearInterval(timer);
			try {
				if (read()?.id === o.tabId) storage.removeItem(key);
			} catch {
				/* ignore */
			}
		}
	};
}
