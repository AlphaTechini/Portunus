/**
 * Default sidebar navigation per role. Routes follow the map in docs/design/DESIGN.md.
 * If the app's routes differ, pass `nav` to <AppShell> instead of editing components.
 */
import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
import FilePlus from '@lucide/svelte/icons/file-plus';
import Boxes from '@lucide/svelte/icons/boxes';
import PackageCheck from '@lucide/svelte/icons/package-check';
import ShieldAlert from '@lucide/svelte/icons/shield-alert';
import Flag from '@lucide/svelte/icons/flag';
import Settings from '@lucide/svelte/icons/settings';
import Inbox from '@lucide/svelte/icons/inbox';
import ClipboardList from '@lucide/svelte/icons/clipboard-list';
import type { NavSection, Role } from './types';

export const DEFAULT_NAV: Record<Role, NavSection[]> = {
	line: [
		{
			items: [
				{ label: 'Dashboard', href: '/line', icon: LayoutDashboard, matchPrefix: false },
				{
					label: 'Release requests',
					href: '/line/requests',
					icon: ClipboardList,
					matchPrefix: false
				},
				{ label: 'New release request', href: '/line/requests/new', icon: FilePlus },
				{ label: 'Containers', href: '/containers', icon: Boxes }
			]
		},
		{
			label: 'Settlement',
			items: [
				{ label: 'Returns and settlement', href: '/line/returns', icon: PackageCheck },
				{ label: 'Held transfers', href: '/line/held', icon: ShieldAlert },
				{ label: 'Disputes', href: '/disputes', icon: Flag }
			]
		},
		{
			label: 'Account',
			items: [{ label: 'Settings', href: '/line/settings', icon: Settings }]
		}
	],
	importer: [
		{
			items: [
				{ label: 'Dashboard', href: '/importer', icon: LayoutDashboard, matchPrefix: false },
				{ label: 'Release requests', href: '/importer/requests', icon: Inbox },
				{ label: 'Containers', href: '/containers', icon: Boxes }
			]
		},
		{
			label: 'Settlement',
			items: [{ label: 'Disputes', href: '/disputes', icon: Flag }]
		}
	],
	// The dispute resolver (platform operator) only sees disputes and containers.
	platform: [
		{
			items: [
				{ label: 'Disputes', href: '/disputes', icon: Flag },
				{ label: 'Containers', href: '/containers', icon: Boxes }
			]
		}
	]
};

export const ROLE_LABEL: Record<Role, string> = {
	line: 'Shipping line',
	importer: 'Importer',
	platform: 'Dispute resolver'
};

export function isActive(href: string, path: string, matchPrefix = true): boolean {
	if (href === path) return true;
	if (!matchPrefix || href === '/') return false;
	return path.startsWith(href.endsWith('/') ? href : `${href}/`);
}
