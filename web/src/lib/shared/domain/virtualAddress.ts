/**
 * Per-container virtual deposit addresses (TIP-1022, brief section 6).
 * Layout: masterId (4 bytes) | 0xfdfd..fd (10 bytes) | userTag (6 bytes).
 * userTag = envPrefix (16 bits) << 32 | per-line sequence (32 bits).
 */
import { VirtualAddress } from 'viem/tempo';

type Hex = `0x${string}`;

/** Fake master id for the simulated chain (flagged unregistered). */
export const SIM_MASTER_ID = '0x5133d000' as const;
/** Default environment prefix when VA_ENV_PREFIX is not set. */
export const DEFAULT_ENV_PREFIX = 0x5a17;

/** Sim master ids for additional lines: 0x5133d000, 0x5133d001, ... */
export function simMasterIdForIndex(index: number): Hex {
	if (!Number.isInteger(index) || index < 0 || index > 255)
		throw new Error(`Bad sim line index: ${index}`);
	return `0x5133d0${index.toString(16).padStart(2, '0')}`;
}

export function userTagFor(envPrefix: number, seq: number): Hex {
	if (!Number.isInteger(envPrefix) || envPrefix < 0 || envPrefix > 0xffff)
		throw new Error('envPrefix must be 16 bits');
	if (!Number.isInteger(seq) || seq < 0 || seq > 0xffffffff) throw new Error('seq must be 32 bits');
	const tag = (BigInt(envPrefix) << 32n) | BigInt(seq);
	return `0x${tag.toString(16).padStart(12, '0')}`;
}

export function depositAddressFor(args: {
	masterId: string;
	envPrefix?: number;
	seq: number;
}): Hex {
	const address = VirtualAddress.from({
		masterId: args.masterId as Hex,
		userTag: userTagFor(args.envPrefix ?? DEFAULT_ENV_PREFIX, args.seq)
	});
	return address.toLowerCase() as Hex;
}

export function isVirtualAddress(address: string): boolean {
	return VirtualAddress.isVirtual(address);
}

/** { masterId, userTag } of a virtual address, or null if it is a plain address. */
export function parseVirtualAddress(address: string): { masterId: Hex; userTag: Hex } | null {
	try {
		if (!VirtualAddress.isVirtual(address)) return null;
		const p = VirtualAddress.parse(address);
		return { masterId: p.masterId as Hex, userTag: p.userTag as Hex };
	} catch {
		return null;
	}
}
