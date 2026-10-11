# Shared helpers for authenticated pages

Import from the barrel: `import { api, useApp, errorMessage, units, ChainResult } from '#lib/app';`

## Route conventions

| Path                                                                                                  | Who      | Notes                                                                   |
| ----------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------- |
| `/signin`                                                                                             | everyone | Outside the shell. `?next=/path` is honoured when the role may open it. |
| `/line`, `/line/requests/new`, `/line/requests/[id]`, `/line/returns`, `/line/held`, `/line/settings` | line     | An importer is redirected to `/importer`.                               |
| `/importer`, `/importer/requests`, `/importer/requests/[id]`                                          | importer | A line user is redirected to `/line`.                                   |
| `/containers`, `/containers/[number]`, `/disputes`                                                    | shared   | Same page for both roles (platform too).                                |
| `/dev/approval`                                                                                       | dev only | Playground for the approval sheet and `ChainResult`.                    |

Everything under `src/routes/(app)/` runs inside `(app)/+layout.svelte`: it waits for the backend, requires a
session (redirects to `/signin?next=...`), enforces the role guard and renders `AppShell`. Pages never check the
session themselves and never render an `AppShell` or a `PageHeader`-less page. The (app) group has `ssr = false`.

Platform users (the dispute resolver) land on `/disputes`; their nav is Disputes and Containers only.

## The app context: `useApp()`

```svelte
<script lang="ts">
	import { useApp, api, errorMessage, units } from '#lib/app';
	import { useAuthedQuery, useAuthedMutation } from '#lib/backend';
	const app = useApp();
	const dash = useAuthedQuery(api.dashboard.line, {});
</script>
```

`app.user` / `app.org` / `app.role` (`'line' | 'importer' | 'platform'`), `app.isDemo`, `app.hasPasskey`,
`app.sessionToken`, `app.chainMode` / `app.isSim`, `app.now()` (product clock: real time plus the sim offset),
`app.clockOffsetMs`, `app.txUrl(hash)` (explorer link or null in sim), `app.displayHash(hash)` (`sim:` prefix in sim),
`app.approve(req)`, `app.signOut()`, `app.switchRole(role)`, `app.switchPersona(userId)`, `app.personas`.

## Approvals: `app.approve()`

```ts
import { isApprovalCancelled, errorMessage } from '#lib/app';
const preview = useAuthedQuery(api.deposits.preview, () => ({ requestId }));
const pay = useAuthedAction(api.deposits.payBatch);

async function payAll() {
	try {
		const { approval } = await app.approve({
			payloadHash: preview.data!.payloadHash,
			title: 'Pay 3 deposits',
			amount: preview.data!.totalUnits, // base-unit string, bigint, or USD number
			amountLabel: 'Total to pay',
			details: [{ label: 'Paid to', value: 'Meridian Ocean Lines' }],
			confirmLabel: 'Pay 3 deposits',
			confirmSublabel: 'One transaction. Fees sponsored.'
		});
		const res = await pay({ requestId, approval }); // `approval` is exactly what the backend expects
	} catch (e) {
		if (!isApprovalCancelled(e)) toast.error('Payment failed', { description: errorMessage(e) });
	}
}
```

A person with a passkey gets the real WebAuthn prompt (`approveWithPasskey(payloadHash)`); a demo persona gets the
passkey-styled sheet with a simulated Face ID animation and the note "Simulated approval (demo persona)".

## Chain results and time

- `<ChainResult txHash finalityMs toastTitle="Deposit held by protocol" />`: finality, hash (`sim:` prefix, no explorer
  link in sim), fires `toast.protocol` once on mount. Mount it when the result arrives.
- `<ProductCountdown target start label ... />`: same props as `<Countdown>`, follows the demo clock. Use this one.
- `units(string)` turns backend money strings into the bigint `<Money>` takes. `relativeToProduct(ts, app.now())`.
- Never use `Date.now()` for product logic, use `app.now()`.

## Demo hooks (sim only)

```ts
const demo = useDemoActions(); // demo.advanceClock(ms), jumpToFreeTimeEnd(id), trySecondPull(id), sendStranger(token), reset()
useDemoPageActions(() => [
	{
		id: 'jump',
		label: 'Jump to end of free time',
		busy: demo.busy === 'jump',
		onclick: () => demo.jumpToFreeTimeEnd(c._id)
	}
]); // adds buttons under "On this page" in the floating panel while the page is mounted
```

## Other helpers

- `errorMessage(e)`: `e.data.message` for backend errors, the message for passkey errors, a generic sentence otherwise.
- `useContainerRef(() => page.params.number)`: resolves `/containers/[number]` to the container id for `containers.get`.
- `safeNext`, `homeFor`, `canOpen`, `containerHref`, `importerRequestHref`, `lineRequestHref` in `routes.ts`.
- `PlaceholderPage`: used by unbuilt routes; replace the route file when you build the page.

## Tests

`npm run test:e2e` runs Playwright against the dev server in the in-browser backend (see `web/e2e/`).
