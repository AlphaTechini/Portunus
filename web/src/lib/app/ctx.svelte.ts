/**
 * App context: the signed-in person, their organization, the chain mode and the product clock.
 *
 * The (app) layout creates it with `createApp()` + `setApp()` and only renders pages once a session
 * exists, so inside any page under `(app)/` `useApp().me` is never null.
 *
 *   <script lang="ts">
 *     import { useApp } from '#lib/app';
 *     const app = useApp();
 *   </script>
 *   <p>{app.user.name} at {app.org.name} ({app.role}), chain: {app.chainMode}</p>
 */
import { getContext, setContext } from 'svelte';
import { goto } from '$app/navigation';
import type { FunctionReturnType } from 'convex/server';
import {
	clearSession,
	getBackend,
	session,
	setSession,
	useAuthedMutation,
	useAuthedQuery,
	useQuery
} from '#lib/backend';
import { api } from './api';
import { ApprovalCancelledError } from './errors';
import { recallPersona, rememberPersona } from './persona';
import { homeFor, type AppRole } from './routes';
import type { RequestApproval } from './approval';

export type Me = NonNullable<FunctionReturnType<typeof api.auth.me>>;
export type AppUser = Me['user'];
export type AppOrg = Me['org'];
export type SystemStatus = FunctionReturnType<typeof api.system.status>;
export type DemoPersona = FunctionReturnType<typeof api.auth.listDemoPersonas>[number];

const KEY = Symbol('portunus.app');

export class AppState {
	#me: () => Me | null | undefined;
	#status: () => SystemStatus | undefined;
	#personas: () => DemoPersona[] | undefined;
	#approver: RequestApproval | null = null;
	#signOutMutation: () => Promise<unknown>;
	/** True while signing out, so the layout does not add a `next` parameter to the redirect. */
	signingOut = $state(false);

	constructor() {
		const meQ = useAuthedQuery(api.auth.me, {});
		const statusQ = useQuery(api.system.status, {});
		const personasQ = useQuery(api.auth.listDemoPersonas, {});
		const signOut = useAuthedMutation(api.auth.signOut);
		this.#me = () => meQ.data;
		this.#status = () => statusQ.data;
		this.#personas = () => personasQ.data;
		this.#signOutMutation = () => signOut({});
		this.#meState = () => ({ data: meQ.data, isLoading: meQ.isLoading, error: meQ.error });
	}

	#meState: () => { data: Me | null | undefined; isLoading: boolean; error: Error | undefined };

	/** Raw `auth.me` state for the layout gate: `data === null` means the session is not valid. */
	get meState() {
		return this.#meState();
	}

	// ---- who -----------------------------------------------------------------------------

	/** Signed-in person and organization. Never null under `(app)/`. */
	get me(): Me {
		return this.#me() as Me;
	}
	/** True once `auth.me` has loaded a signed-in person. */
	get ready(): boolean {
		return !!this.#me();
	}
	get user(): AppUser {
		return this.me.user;
	}
	get org(): AppOrg {
		return this.me.org;
	}
	get role(): AppRole {
		return (this.#me()?.user.role ?? 'importer') as AppRole;
	}
	get home(): string {
		return homeFor(this.role);
	}
	/** Demo persona (seeded user without a passkey). */
	get isDemo(): boolean {
		return !!this.#me()?.user.demo;
	}
	get hasPasskey(): boolean {
		return !!this.#me()?.user.hasPasskey;
	}
	get sessionToken(): string {
		return session.token ?? '';
	}
	/** Demo personas available for one-click sign in (empty when the demo is turned off). */
	get personas(): DemoPersona[] {
		return this.#personas() ?? [];
	}

	// ---- chain and clock -----------------------------------------------------------------

	get status(): SystemStatus | undefined {
		return this.#status();
	}
	/** 'sim' until the status has loaded: the safe default is to show the simulated badge. */
	get chainMode(): 'sim' | 'live' {
		return this.#status()?.chainMode === 'live' ? 'live' : 'sim';
	}
	get isSim(): boolean {
		return this.chainMode === 'sim';
	}
	get explorerUrl(): string | null {
		return this.#status()?.explorerUrl ?? null;
	}
	/** Product clock offset from real time, ms (0 in live mode). */
	get clockOffsetMs(): number {
		return this.#status()?.simClockOffsetMs ?? 0;
	}
	/** Product "now" in ms: real time plus the sim clock offset. Use for all countdowns and ages. */
	now(): number {
		return Date.now() + this.clockOffsetMs;
	}
	/** Explorer link for a transaction hash; null on the simulated chain. */
	txUrl(hash: string): string | null {
		const base = this.explorerUrl;
		if (!base || this.isSim || !hash || hash.startsWith('sim:')) return null;
		return `${base.replace(/\/$/, '')}/tx/${hash}`;
	}
	/** Hash as displayed: `sim:0x...` on the simulated chain, plain `0x...` live. */
	displayHash(hash: string): string {
		if (!hash || hash.startsWith('sim:')) return hash;
		return this.isSim ? `sim:${hash}` : hash;
	}

	// ---- approval ------------------------------------------------------------------------

	/** @internal registered by ApproveSheet. */
	_setApprover(fn: RequestApproval | null) {
		this.#approver = fn;
	}
	/**
	 * Ask the person to approve a payload with their passkey. Resolves `{ approval, approvedWith }`
	 * or rejects with `ApprovalCancelledError` (check with `isApprovalCancelled`).
	 */
	approve: RequestApproval = (req) => {
		if (!this.#approver) return Promise.reject(new ApprovalCancelledError());
		return this.#approver(req);
	};

	// ---- session actions -----------------------------------------------------------------

	async signOut(): Promise<void> {
		this.signingOut = true;
		try {
			await this.#signOutMutation();
		} catch {
			/* the token may already be gone */
		}
		clearSession();
		await goto('/signin');
		this.signingOut = false;
	}

	/** Demo only: become another persona (new session) and land on `to` (default: their home). */
	async switchPersona(userId: string, to?: string): Promise<void> {
		const target = this.personas.find((p) => p.userId === userId);
		if (!target) return;
		const { sessionToken } = await signInDemo(userId);
		const old = session.token;
		setSession(sessionToken);
		rememberPersona(target.orgKind, userId);
		if (old) void signOutToken(old);
		await goto(to ?? homeFor(target.orgKind));
	}

	/** Demo only: switch to the last persona used for `role`, else the first one that has it. */
	async switchRole(role: 'line' | 'importer'): Promise<void> {
		const options = this.personas.filter((p) => p.orgKind === role);
		if (!options.length) return;
		const remembered = recallPersona(role);
		const pick = options.find((p) => p.userId === remembered) ?? options[0];
		await this.switchPersona(pick.userId);
	}
}

// -- plain backend calls: sign in needs no token, and the old token must be used explicitly --

async function signInDemo(userId: string): Promise<{ sessionToken: string }> {
	return (await getBackend().mutation(api.auth.signInAsDemo, { userId: userId as never })) as {
		sessionToken: string;
	};
}

async function signOutToken(token: string) {
	try {
		await getBackend().mutation(api.auth.signOut, { sessionToken: token });
	} catch {
		/* best effort */
	}
}

// ---- context ---------------------------------------------------------------------------

export function createApp(): AppState {
	return new AppState();
}

export function setApp(app: AppState): AppState {
	return setContext(KEY, app);
}

/** The app context. Only valid inside `src/routes/(app)/**`. */
export function useApp(): AppState {
	const app = getContext<AppState | undefined>(KEY);
	if (!app) throw new Error('useApp() must be called inside the (app) route group.');
	return app;
}
