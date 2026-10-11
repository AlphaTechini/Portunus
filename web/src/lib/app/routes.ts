/**
 * Route conventions for the authenticated app. Used by the (app) layout guard, the sign-in page
 * and anything that needs "where does this person land".
 *
 *   line      /line/*  plus the shared /containers/* and /disputes
 *   importer  /importer/*  plus the shared /containers/* and /disputes
 *   platform  /disputes and /containers/* only (the dispute resolver)
 */

export type AppRole = 'line' | 'importer' | 'platform';

export const HOME: Record<AppRole, string> = {
	line: '/line',
	importer: '/importer',
	platform: '/disputes'
};

export function homeFor(role: AppRole): string {
	return HOME[role];
}

/** Which role owns a path prefix, or null for shared routes. */
export function sectionOwner(pathname: string): AppRole | null {
	if (pathname === '/line' || pathname.startsWith('/line/')) return 'line';
	if (pathname === '/importer' || pathname.startsWith('/importer/')) return 'importer';
	return null;
}

/** May this role open this path? Shared routes are open to everyone. */
export function canOpen(role: AppRole, pathname: string): boolean {
	const owner = sectionOwner(pathname);
	return owner === null || owner === role;
}

/**
 * Validate a `next` query parameter: same-origin app paths only (no scheme, no `//host`), and only
 * if this role may open it. Falls back to the role's home.
 */
export function safeNext(next: string | null | undefined, role: AppRole): string {
	if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
		return homeFor(role);
	}
	if (next.startsWith('/signin')) return homeFor(role);
	const path = next.split(/[?#]/)[0];
	return canOpen(role, path) ? next : homeFor(role);
}

/** Container detail URL. */
export const containerHref = (number: string) => `/containers/${encodeURIComponent(number)}`;
/** Importer release request URL (pay deposits or authorize). */
export const importerRequestHref = (id: string) => `/importer/requests/${encodeURIComponent(id)}`;
/** Line release request URL. */
export const lineRequestHref = (id: string) => `/line/requests/${encodeURIComponent(id)}`;
