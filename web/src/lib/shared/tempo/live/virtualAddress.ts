// Per-container virtual deposit addresses (TIP-1022). Pure and offline: no transaction, no cost.
// userTag (6 bytes) = envPrefix (16 bits, random per deployment) << 32 | containerSeq (32 bits).
import { VirtualAddress } from 'viem/tempo';
import type { Address, Hex } from './constants';

export function userTagOf(envPrefix: number, containerSeq: number | bigint): Hex {
	const seq = BigInt(containerSeq);
	if (seq < 0n || seq >= 1n << 32n) throw new Error(`container seq ${seq} does not fit in 32 bits`);
	if (!Number.isInteger(envPrefix) || envPrefix < 0 || envPrefix > 0xffff) {
		throw new Error('envPrefix must be an integer in 0..65535');
	}
	return `0x${((BigInt(envPrefix) << 32n) | seq).toString(16).padStart(12, '0')}`;
}

export function createVirtualAddress(a: {
	masterId: Hex;
	envPrefix: number;
	containerSeq: number | bigint;
}): Address {
	return VirtualAddress.from({ masterId: a.masterId, userTag: userTagOf(a.envPrefix, a.containerSeq) });
}

export function parseVirtualAddress(address: string): {
	masterId: Hex;
	userTag: Hex;
	envPrefix: number;
	containerSeq: number;
} | null {
	if (!VirtualAddress.isVirtual(address)) return null;
	const { masterId, userTag } = VirtualAddress.parse(address);
	const tag = BigInt(userTag);
	return {
		masterId,
		userTag,
		envPrefix: Number(tag >> 32n),
		containerSeq: Number(tag & 0xffffffffn)
	};
}
