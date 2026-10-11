/** Minimal platform interfaces so the runtime is testable in Node. */

export interface StorageLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

export interface ChannelLike {
	postMessage(message: unknown): void;
	onmessage: ((event: { data: unknown }) => void) | null;
	close(): void;
}

export type ChannelFactory = (name: string) => ChannelLike | null;

/** A Convex function reference (`api.x.y`) or a "module:export" string. */
export type RefLike = unknown;
