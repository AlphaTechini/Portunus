import type { IconComponent, Tone, ContainerState } from './status';

export type { IconComponent, Tone, ContainerState };

export interface SelectOption {
	value: string;
	label: string;
	disabled?: boolean;
}

export interface SegmentedOption<V extends string = string> {
	value: V;
	label: string;
	/** Second line, shown in the "cards" variant. */
	description?: string;
	icon?: IconComponent;
	disabled?: boolean;
}

export interface TabItem<V extends string = string> {
	value: V;
	label: string;
	count?: number;
	icon?: IconComponent;
	disabled?: boolean;
}

export interface TableColumn<K extends string = string> {
	key: K;
	label: string;
	align?: 'left' | 'right' | 'center';
	/** CSS width, e.g. '160px' or '20%'. */
	width?: string;
	/** Numeric column: right aligned, tabular numerals. */
	numeric?: boolean;
	/** Hide below the given breakpoint. */
	hideBelow?: 'sm' | 'md' | 'lg';
	/** Visually hidden header text (still read by screen readers). */
	srOnlyLabel?: boolean;
}

export interface Crumb {
	label: string;
	href?: string;
}

export type TimelineKind =
	| 'request'
	| 'deposit'
	| 'authorization'
	| 'release'
	| 'pull'
	| 'refused'
	| 'return'
	| 'charge'
	| 'settlement'
	| 'refund'
	| 'revocation'
	| 'held'
	| 'dispute'
	| 'note';

export interface TimelineEntry {
	id: string;
	kind: TimelineKind;
	/** "Deposit paid", "Detention pull, day 3". */
	title: string;
	/** ISO string, Date or ms. */
	timestamp: string | number | Date;
	/** Amount in USD (number) or base units (bigint). Positive = into guard / to line. */
	amount?: number | bigint;
	/** Memo text exactly as on-chain. */
	memo?: string;
	txHash?: string;
	/** Explorer URL for the tx. */
	href?: string;
	/** Time from submit to finality, in ms. */
	finalityMs?: number;
	status?: 'confirmed' | 'pending' | 'failed';
	/** "Northgate Lines", "Importer", "Settlement contract". */
	actor?: string;
	/** Extra line of plain text. */
	detail?: string;
}

export interface NavItem {
	label: string;
	href: string;
	icon: IconComponent;
	/** Small count badge, e.g. open disputes. */
	badge?: number;
	/** Treat any path starting with href as active. Default true except for '/'. */
	matchPrefix?: boolean;
}

export interface NavSection {
	label?: string;
	items: NavItem[];
}

export type Role = 'line' | 'importer' | 'platform';

/** Roles the demo role switch can toggle between. */
export type SwitchableRole = Exclude<Role, 'platform'>;

export interface Org {
	id: string;
	name: string;
	role: Role;
	/** "Lagos, Apapa" etc. */
	location?: string;
}

export type LiveState = 'live' | 'connecting' | 'offline';
