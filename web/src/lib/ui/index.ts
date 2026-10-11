/**
 * Portunus UI barrel. Import components from here:
 *   import { Button, StatusPill, TempoTag } from '#lib/ui';
 * Styles: tokens.css and global.css are imported once in src/routes/+layout.svelte.
 */

// Primitives
export { default as Button } from './Button.svelte';
export { default as IconButton } from './IconButton.svelte';
export { default as Spinner } from './Spinner.svelte';
export { default as Badge } from './Badge.svelte';
export { default as Tooltip } from './Tooltip.svelte';
export { default as Skeleton } from './Skeleton.svelte';
export { default as EmptyState } from './EmptyState.svelte';

// Forms
export { default as Field } from './Field.svelte';
export { default as Input } from './Input.svelte';
export { default as Select } from './Select.svelte';
export { default as Textarea } from './Textarea.svelte';
export { default as Checkbox } from './Checkbox.svelte';
export { default as Switch } from './Switch.svelte';
export { default as SegmentedControl } from './SegmentedControl.svelte';

// Layout and containers
export { default as Card } from './Card.svelte';
export { default as Tabs } from './Tabs.svelte';
export { default as Modal } from './Modal.svelte';
export { default as Dialog } from './Modal.svelte';
export { default as Drawer } from './Drawer.svelte';
export { default as PageHeader } from './PageHeader.svelte';
export { default as AppShell } from './AppShell.svelte';
export { default as Logo } from './Logo.svelte';
export { default as ThemeToggle } from './ThemeToggle.svelte';
export { default as NetworkBadge } from './NetworkBadge.svelte';
export { default as LiveIndicator } from './LiveIndicator.svelte';
export { default as Toaster } from './Toaster.svelte';

// Data display
export { default as Table } from './Table.svelte';
export { default as Stat } from './Stat.svelte';
export { default as Sparkline } from './Sparkline.svelte';
export { default as Money } from './Money.svelte';
export { default as Hash } from './Hash.svelte';
export { default as Address } from './Hash.svelte';
export { default as ContainerNumber } from './ContainerNumber.svelte';
export { default as Countdown } from './Countdown.svelte';
export { default as Meter } from './Meter.svelte';
export { default as Timeline } from './Timeline.svelte';

// Domain
export { default as StatusPill } from './StatusPill.svelte';
export { default as TempoTag } from './TempoTag.svelte';
export { default as PasskeyButton } from './PasskeyButton.svelte';

// Modules
export { toast } from './toast.svelte';
export { theme } from './theme.svelte';
export { STATUS, CONTAINER_STATES, statusOf } from './status';
export type { ContainerState, StatusDef, Tone, IconComponent } from './status';
export { TEMPO_FEATURES, TEMPO_NETWORK, TEMPO_PROTOCOL_NOTE } from './tempo';
export type { TempoFeatureKey, TempoFeature } from './tempo';
export { DEFAULT_NAV, ROLE_LABEL, isActive } from './nav';
export { copyText } from './copy';
export * from './format';
export type * from './types';
