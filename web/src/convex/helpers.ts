/**
 * Shared helpers for Convex functions: environment, product clock, errors, sessions,
 * role checks, notifications, the container timeline and state changes.
 * Standard Convex APIs only (this file also runs in the in-browser runtime).
 */
import { ConvexError } from 'convex/values';
import { keccak256, stringToHex } from 'viem';
import type { Doc, Id } from './_generated/dataModel';
import type { DatabaseReader, DatabaseWriter, MutationCtx, QueryCtx } from './_generated/server';
import { assertTransition, type ContainerState } from '../lib/shared/domain/states';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

/** Read a Convex env var. Safe in the browser runtime where `process` may not exist. */
export function env(name: string): string | undefined {
	try {
		return typeof process !== 'undefined' ? process.env?.[name] : undefined;
	} catch {
		return undefined;
	}
}

export type ChainMode = 'sim' | 'live';

export function chainMode(): ChainMode {
	return env('TEMPO_MODE') === 'live' ? 'live' : 'sim';
}

export const isLive = (): boolean => chainMode() === 'live';

export function demoEnabled(): boolean {
	return env('DEMO_MODE') !== 'off';
}

/** Sim finality is a real wait inside actions; tests and fast demos can switch it off. */
export function simFinalitySleepEnabled(): boolean {
	return env('SIM_FINALITY_SLEEP') !== 'off';
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type ErrorCode =
	| 'UNAUTHENTICATED'
	| 'FORBIDDEN'
	| 'NOT_FOUND'
	| 'INVALID'
	| 'INVALID_CONTAINER'
	| 'INVALID_STATE'
	| 'CONFLICT'
	| 'NOT_SUPPORTED'
	| 'DEMO_DISABLED'
	| 'APPROVAL_REQUIRED'
	| 'INSUFFICIENT_BALANCE'
	| 'WINDOW_OPEN'
	| 'WINDOW_CLOSED'
	| 'CHARGE_TOO_HIGH'
	| 'CHAIN_ERROR'
	| 'NOT_ELIGIBLE';

/** User-facing error. `data` is `{ code, message, ...extra }`. */
export function appError(code: ErrorCode, message: string, extra: Record<string, string | number | boolean> = {}) {
	return new ConvexError({ code, message, ...extra });
}

// ---------------------------------------------------------------------------
// Product clock (ARCHITECTURE section 3)
// ---------------------------------------------------------------------------

export async function clockOffset(ctx: { db: DatabaseReader }): Promise<number> {
	if (isLive()) return 0;
	const meta = await ctx.db.query('sim_meta').first();
	return meta?.clockOffsetMs ?? 0;
}

/** "Product now": Date.now() + sim clock offset in sim, Date.now() in live. */
export async function productNow(ctx: { db: DatabaseReader }): Promise<number> {
	return Date.now() + (await clockOffset(ctx));
}

/** When to run a job whose target is a product timestamp. */
export function schedulerTime(targetProductTime: number, offsetMs: number): number {
	return Math.max(Date.now(), targetProductTime - offsetMs);
}

// ---------------------------------------------------------------------------
// Randomness and ids
// ---------------------------------------------------------------------------

export function randomHex(bytes: number): string {
	const a = new Uint8Array(bytes);
	crypto.getRandomValues(a);
	let s = '';
	for (const b of a) s += b.toString(16).padStart(2, '0');
	return s;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function randomCode(len = 6): string {
	const a = new Uint8Array(len);
	crypto.getRandomValues(a);
	let s = '';
	for (const b of a) s += CODE_ALPHABET[b % CODE_ALPHABET.length];
	return s;
}

/** Deterministic fake address for sim accounts: last 20 bytes of keccak256(label). */
export function simAddress(label: string): string {
	return `0x${keccak256(stringToHex(`portunus-sim-address:${label}`)).slice(-40)}`;
}

export const lc = (s: string): string => s.toLowerCase();

// ---------------------------------------------------------------------------
// Sessions and roles
// ---------------------------------------------------------------------------

export interface SessionInfo {
	session: Doc<'sessions'>;
	user: Doc<'users'>;
	org: Doc<'organizations'>;
}

export async function findSession(ctx: { db: DatabaseReader }, token: string | undefined): Promise<SessionInfo | null> {
	if (!token) return null;
	const session = await ctx.db
		.query('sessions')
		.withIndex('by_token', (q) => q.eq('token', token))
		.unique();
	if (!session) return null;
	if (session.expiresAt < Date.now()) return null;
	const user = await ctx.db.get(session.userId);
	if (!user) return null;
	const org = await ctx.db.get(user.orgId);
	if (!org) return null;
	return { session, user, org };
}

export async function requireSession(ctx: { db: DatabaseReader }, token: string | undefined): Promise<SessionInfo> {
	const s = await findSession(ctx, token);
	if (!s) throw appError('UNAUTHENTICATED', 'Please sign in again.');
	return s;
}

export async function requireRole(
	ctx: { db: DatabaseReader },
	token: string | undefined,
	role: 'line' | 'importer' | 'platform'
): Promise<SessionInfo> {
	const s = await requireSession(ctx, token);
	if (s.org.kind !== role || s.user.role !== role) {
		throw appError('FORBIDDEN', `This action is for ${role === 'line' ? 'shipping lines' : role === 'importer' ? 'importers' : 'the platform'}.`);
	}
	return s;
}

export const requireLine = (ctx: { db: DatabaseReader }, token: string | undefined) => requireRole(ctx, token, 'line');
export const requireImporter = (ctx: { db: DatabaseReader }, token: string | undefined) =>
	requireRole(ctx, token, 'importer');

/** Container visible to the session's org (line, importer) or to a platform resolver with a dispute. */
export async function loadContainerFor(
	ctx: { db: DatabaseReader },
	s: SessionInfo,
	containerId: Id<'containers'>
): Promise<Doc<'containers'>> {
	const c = await ctx.db.get(containerId);
	if (!c) throw appError('NOT_FOUND', 'Container not found.');
	if (s.org.kind === 'line' && c.lineOrgId === s.org._id) return c;
	if (s.org.kind === 'importer' && c.importerOrgId === s.org._id) return c;
	if (s.org.kind === 'platform') {
		const dispute = await ctx.db
			.query('disputes')
			.withIndex('by_container', (q) => q.eq('containerId', c._id))
			.first();
		if (dispute && dispute.resolverOrgId === s.org._id) return c;
	}
	throw appError('NOT_FOUND', 'Container not found.');
}

export async function loadRequestFor(
	ctx: { db: DatabaseReader },
	s: SessionInfo,
	requestId: Id<'releaseRequests'>
): Promise<Doc<'releaseRequests'>> {
	const r = await ctx.db.get(requestId);
	if (!r) throw appError('NOT_FOUND', 'Release request not found.');
	if (s.org.kind === 'line' && r.lineOrgId === s.org._id) return r;
	if (s.org.kind === 'importer' && r.importerOrgId === s.org._id) return r;
	throw appError('NOT_FOUND', 'Release request not found.');
}

// ---------------------------------------------------------------------------
// Approvals (passkey or demo confirm sheet)
// ---------------------------------------------------------------------------

export interface Approval {
	method: 'passkey' | 'demo';
	credentialId?: string;
	payloadHash?: string;
	assertion?: unknown;
}

export function checkApprovalMethod(user: Doc<'users'>, approval: Approval): 'passkey' | 'demo' {
	if (approval.method === 'passkey') {
		if (!user.passkey) throw appError('APPROVAL_REQUIRED', 'This account has no passkey. Use the demo confirmation.');
		if (approval.credentialId && approval.credentialId !== user.passkey.credentialId) {
			throw appError('APPROVAL_REQUIRED', 'That passkey does not belong to this account.');
		}
		return 'passkey';
	}
	if (!user.demo) throw appError('APPROVAL_REQUIRED', 'Approve this action with your passkey.');
	return 'demo';
}

// ---------------------------------------------------------------------------
// Timeline, notifications, state changes
// ---------------------------------------------------------------------------

export async function logEvent(
	ctx: { db: DatabaseWriter },
	containerId: Id<'containers'>,
	kind: string,
	title: string,
	at: number,
	detail?: string,
	actor?: string
): Promise<void> {
	await ctx.db.insert('containerEvents', { containerId, kind, title, detail, at, actor });
}

export async function notify(
	ctx: { db: DatabaseWriter },
	n: {
		orgId: Id<'organizations'>;
		kind: string;
		title: string;
		body: string;
		containerId?: Id<'containers'>;
		userId?: Id<'users'>;
		at: number;
	}
): Promise<void> {
	await ctx.db.insert('notifications', {
		orgId: n.orgId,
		userId: n.userId,
		kind: n.kind,
		title: n.title,
		body: n.body,
		containerId: n.containerId,
		createdAt: n.at
	});
}

/** Move a container to a new state, enforcing the state machine. Returns the updated doc. */
export async function setState(
	ctx: { db: DatabaseWriter },
	container: Doc<'containers'>,
	to: ContainerState,
	at: number,
	patch: Partial<Omit<Doc<'containers'>, '_id' | '_creationTime' | 'state' | 'stateChangedAt'>> = {}
): Promise<Doc<'containers'>> {
	assertTransition(container.state, to);
	await ctx.db.patch(container._id, { ...patch, state: to, stateChangedAt: at });
	return { ...container, ...patch, state: to, stateChangedAt: at };
}

export async function getOrg(ctx: { db: DatabaseReader }, id: Id<'organizations'>): Promise<Doc<'organizations'>> {
	const o = await ctx.db.get(id);
	if (!o) throw appError('NOT_FOUND', 'Organization not found.');
	return o;
}

export async function getRelationship(
	ctx: { db: DatabaseReader },
	lineOrgId: Id<'organizations'>,
	importerOrgId: Id<'organizations'>
): Promise<Doc<'relationships'> | null> {
	return ctx.db
		.query('relationships')
		.withIndex('by_pair', (q) => q.eq('lineOrgId', lineOrgId).eq('importerOrgId', importerOrgId))
		.unique();
}

/** Addresses an importer organisation pays from: org address and every user passkey address. */
export async function importerAddresses(ctx: { db: DatabaseReader }, org: Doc<'organizations'>): Promise<string[]> {
	const out = new Set<string>();
	if (org.tempoAddress) out.add(lc(org.tempoAddress));
	const users = await ctx.db
		.query('users')
		.withIndex('by_org', (q) => q.eq('orgId', org._id))
		.collect();
	for (const u of users) if (u.passkey?.address) out.add(lc(u.passkey.address));
	return [...out];
}

export type { MutationCtx, QueryCtx };
