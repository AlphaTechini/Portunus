/**
 * Shared helpers for authenticated pages.  Import from `#lib/app`:
 *
 *   import { api, useApp, errorMessage, units, ChainResult } from '#lib/app';
 *
 * See README.md in this folder for the conventions.
 */
export { api } from './api';
export {
	AppState,
	createApp,
	setApp,
	useApp,
	type AppOrg,
	type AppUser,
	type DemoPersona,
	type Me,
	type SystemStatus
} from './ctx.svelte';
export {
	ApprovalCancelledError,
	GENERIC_ERROR,
	errorCode,
	errorMessage,
	isApprovalCancelled
} from './errors';
export type { ApprovalArg, ApprovalRequest, ApprovalResult } from './approval';
export {
	HOME,
	canOpen,
	containerHref,
	homeFor,
	importerRequestHref,
	lineRequestHref,
	safeNext,
	sectionOwner,
	type AppRole
} from './routes';
export { recallPersona, rememberPersona } from './persona';
export {
	DAY_MS,
	HOUR_MS,
	getDemoPageActions,
	useDemoActions,
	useDemoPageActions,
	type DemoBusy,
	type DemoPageAction
} from './demo.svelte';
export { useContainerRef } from './useContainer.svelte';
export { relativeToProduct, sumUnits, units } from './format';

export { default as ApproveSheet } from './ApproveSheet.svelte';
export { default as ChainResult } from './ChainResult.svelte';
export { default as DemoControls } from './DemoControls.svelte';
export { default as ProductCountdown } from './ProductCountdown.svelte';
export { default as PlaceholderPage } from './PlaceholderPage.svelte';
export { default as AppLoading } from './AppLoading.svelte';
