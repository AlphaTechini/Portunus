# Portunus design system

The spec every page must follow. The system lives in `web/src/lib/ui/`; the living reference is `/styleguide` (run the dev server and open it next to this file). Screenshots of the reference pages are in `docs/design/screenshots/`.

If a page needs something this document does not cover, compose it from the existing components and tokens first. Add a new component to `web/src/lib/ui/` only if it will be used on two or more pages, and add it to the styleguide when you do.

---

## 1. Principles

1. **Serious trade-finance software, not a crypto app.** The people using this are port agents and clearing agents. Words like wallet, gas, chain, token, web3 do not appear in primary UI. Say "deposit", "refund", "charge", "release order", "return receipt". Protocol words appear only inside Tempo tags and their tooltips.
2. **The money is the hero.** Every screen answers: how much, for which container, held where, until when. Amounts are large, tabular and exact. Nothing is shown as paid or refunded until it is final on-chain (use `pending_onchain` until then).
3. **Show the protocol working, name it once.** Each Tempo feature is named on the page where the viewer sees it working, with a `TempoTag`. One tag per feature per view; never decorate with them.
4. **Restraint.** One accent (petrol). Ink for primary actions. 1px hairlines do the structuring, shadows stay soft. No gradients on surfaces, no glass, no glow, no emoji, no illustrations of coins.
5. **Both sides see the same record.** Line and importer screens use the same components, labels and states for the same thing, so a screenshot from either side reads identically.
6. **Calm under time pressure.** Countdowns and detention meters are live but quiet: amber within 24 hours, orange once detention runs, red only for a refused pull, a dispute or an exhausted deposit.
7. **Copy rules.** Sentence case everywhere. No em dashes: use commas, colons or periods. Each evidence figure stands alone; never add figures up. Dates are day-month-year. Use "to" for ranges ("60 to 90 days").

---

## 2. Brand

- **Name:** Portunus, the Roman god of keys, doors and harbours. His symbol is a key.
- **Mark:** a harbour gate (an arch on a quay) with a keyhole cut through it. Component: `<Logo />`. Variants `full` (mark and wordmark), `mark`, `wordmark`; tones `brand` (petrol mark, ink quay), `mono` (currentColor), `inverse` (for the ink band).
- **Wordmark:** Newsreader at 560 weight, tracking -0.015em. Never retype it; use the component.
- **Key motif, used sparingly:** the mark itself, the small diamond-and-dot glyph inside `TempoTag` (protocol), and nothing else. No key icons as decoration, no keyhole patterns, no harbour photography.
- **Favicon:** `web/src/lib/assets/favicon.svg` (the mark, adapts to dark mode).
- **Clear space:** at least the height of the quay line times four on every side. Minimum size 16px (mark), 18px (full).

---

## 3. Typography

| Role | Family | Token |
|---|---|---|
| Interface | Inter Variable (opsz), features cv02 cv03 cv04 cv11 | `--font-sans` |
| Editorial display (landing only, plus the wordmark) | Newsreader Variable | `--font-display` |
| Identifiers: container numbers, B/L, hashes, memos, TIP numbers | Geist Mono Variable | `--font-mono` |

Fonts are self-hosted through `@fontsource-variable/*` and imported in `global.css`. Do not add other families.

**Scale** (size / line-height tokens come in pairs, `--text-*` and `--leading-*`):

| Token | Size | Use |
|---|---|---|
| `--text-2xs` | 11 | Overlines (uppercase, `--tracking-caps`), tiny meta |
| `--text-xs` | 12 | Meta, table headers, hints, timestamps |
| `--text-sm` | 13 | **Default app text** (body is 13px) |
| `--text-base` | 14 | Card titles, subtitles, emphasized body |
| `--text-md` | 16 | Landing body, inputs on touch devices |
| `--text-lg` | 18 | Dialog titles, landing lead |
| `--text-xl` | 20 | Section headings inside the app |
| `--text-2xl` | 24 | **Page titles** (PageHeader) |
| `--text-3xl` | 30 | KPI values (Stat) |
| `--text-4xl` | 40 | Landing section titles (via clamp) |
| `--text-5xl` / `--text-6xl` | 56 / 72 | Landing display, Money `display` |

Weights: `--weight-regular` 420, `--weight-medium` 520, `--weight-semibold` 600, `--weight-bold` 680. Headings are semibold with `--tracking-snug` or `--tracking-tight`; never bold body text for emphasis, use `--color-text` against secondary text instead.

**Tabular numerals are mandatory** for every amount, count, duration and timestamp: use `<Money>`, `<Countdown>`, `<Stat>`, or the `.tabular` utility class.

---

## 4. Color

Light is the primary theme. Dark applies automatically from `prefers-color-scheme`, or explicitly with `[data-theme="dark"]` / `[data-theme="light"]` on `<html>` (`ThemeToggle` and `theme.svelte.ts` manage this; `app.html` applies the stored choice before first paint).

**Use semantic tokens only.** The raw palette (`--gray-*`, `--petrol-*`) exists for the token file, not for components.

### Surfaces and text

| Token | Use |
|---|---|
| `--color-bg` | App canvas |
| `--color-bg-elevated` | Inputs, tinted landing sections |
| `--color-surface` | Cards, tables, panels |
| `--color-surface-raised` | Popovers, menus, dialogs, toasts |
| `--color-surface-sunken` | Wells: memo blocks, table header, disabled inputs |
| `--color-surface-hover` / `--color-surface-active` | Row and item hover / pressed |
| `--color-border-subtle` / `--color-border` / `--color-border-strong` | Inner dividers / card edges / hover edges |
| `--color-text` / `--color-text-secondary` / `--color-text-tertiary` / `--color-text-disabled` | Primary / supporting / meta (AA on every surface) / disabled |
| `--color-band-bg`, `--color-band-text`, `--color-band-text-secondary`, `--color-band-border`, `--color-band-surface`, `--color-band-accent` | The ink band (landing "Why Tempo") |
| `--color-overlay` | Modal scrim |

### Actions and accent

| Token | Use |
|---|---|
| `--color-primary`, `--color-primary-hover`, `--color-primary-fg` | Ink primary button, selected checkbox. One primary per view. |
| `--color-accent`, `--color-accent-hover`, `--color-accent-fg` | **Petrol, the only accent.** It means "enforced by the protocol". Use for the protocol action button (`variant="accent"`: pay, authorize, settle), active nav icon, switches, focus, meters, Tempo tags. |
| `--color-accent-text` | Links and accent text on surfaces |
| `--color-accent-subtle`, `--color-accent-muted`, `--color-accent-border` | Tinted fills and borders |
| `--color-focus`, `--color-focus-ring` | Focus outline (`box-shadow: var(--color-focus-ring)`) |

### Tones

Seven tones, each with `-fg` (text and icon), `-bg` (fill), `-border` and `-solid` (dots, bars): `--tone-neutral-*`, `--tone-protocol-*`, `--tone-info-*`, `--tone-success-*`, `--tone-warning-*`, `--tone-caution-*`, `--tone-danger-*`. Every fg/bg pair is above 5.9:1 in light and 7.7:1 in dark. Tones reach pages through `StatusPill`, `Badge`, `Timeline`, `Meter` and `Countdown`; pages should not pick tones by hand except via `<Badge tone=...>`.

| Tone | Meaning |
|---|---|
| neutral | Not started, informational, pending |
| protocol | Held or authorized by the Tempo protocol, settling |
| info | Released, returned: logistics milestones |
| success | In free time, settled, refunded |
| warning | Awaiting deposit, ending within 24 hours |
| caution | In detention, a charge or pull |
| danger | Disputed, refused, failed, deposit exhausted |

---

## 5. Space, radius, elevation, motion, layout

- **Spacing** (4px grid): `--space-0-5` 2, `--space-1` 4, `--space-1-5` 6, `--space-2` 8, `--space-2-5` 10, `--space-3` 12, `--space-4` 16, `--space-5` 20, `--space-6` 24, `--space-8` 32, `--space-10` 40, `--space-12` 48, `--space-16` 64, `--space-20` 80, `--space-24` 96, `--space-32` 128. Card padding 20 (`md`), gaps between cards 16, between page sections 32 to 40.
- **Radius:** `--radius-xs` 4 (chips, kbd), `--radius-sm` 6 (small buttons, tags), `--radius-md` 8 (buttons, inputs), `--radius-lg` 12 (cards, tables), `--radius-xl` 16 (dialogs, hero panels), `--radius-full`.
- **Elevation:** `--shadow-xs` (buttons, inputs), `--shadow-sm` (cards), `--shadow-md` (hover lift), `--shadow-lg` (toasts, floating cards), `--shadow-overlay` (dialogs, popovers). Always pair with a 1px border.
- **Motion:** `--ease-out` for entering, `--ease-standard` for state changes, `--ease-in-out` for loops. `--duration-fast` 140ms (hover), `--duration-base` 200ms (toggles, indicators), `--duration-slow` 320ms (dialogs, toasts), `--duration-slower` 520ms (meters). Nothing bounces. `prefers-reduced-motion` collapses all animation (handled in `global.css`).
- **Z-index:** `--z-sticky`, `--z-nav`, `--z-dropdown`, `--z-overlay`, `--z-toast`, `--z-tooltip`.
- **Floating layers never cover the primary action.** Toasts stack top right, just under the top bar (full width under the top bar on phones), clear of drawer and sheet footers where the primary action lives. The demo controls dock in the sidebar footer on desktop and shrink to a 44px round button bottom right on tablet and phone; the content area keeps 80px of bottom padding on phones so the last row is never under it.
- **Layout:** `--sidebar-width` 240, `--sidebar-rail-width` 64, `--topbar-height` 56, `--content-max` 1280 (app), `--content-narrow` 720 (single-column forms), `--page-max` 1200 (landing), `--gutter` (fluid page gutter).
- **Breakpoints:** desktop at 1024 and up (full sidebar), tablet 768 to 1023 (icon rail with hover labels), mobile under 768 (top bar with a menu button that opens a top menu). Content grids collapse: 4 columns to 2 at 1100, to 1 at 760.

---

## 6. Data formatting

All helpers are in `web/src/lib/ui/format.ts` and re-exported from `#lib/ui`.

| Data | Rule | Use |
|---|---|---|
| Money | USD stablecoin, `$` prefix, thousands separators, **always 2 decimals**, tabular numerals. Negative uses a true minus (−). Base units (bigint) use 6 decimals. Show the token symbol (`unit="pathUSD"`) only where the token identity matters: paying, held transfers. Compact (`$1.2M`) only on KPI tiles, never on an amount someone pays or receives. | `<Money amount={1250} />`, `formatMoney()` |
| Container number | ISO 6346, shown as `MSCU 123456-6` in mono, owner code semibold, check digit muted. Validate the check digit on input. Size/type chip (`40HC`) beside it. | `<ContainerNumber value="MSCU1234566" type="40HC" />`, `isValidContainerNumber()` |
| Bill of lading, return receipt (EIR) | Mono, as issued, no reformatting. | `.mono` |
| Address, tx hash, key id | Mono, middle truncation `0x8f3a5c…c41e` (6 + 4), full value in `title`, copy button always, explorer link when available. | `<Hash value kind="tx" href />` (alias `Address`) |
| Dates | `11 Oct 2026` (day month year). | `formatDate()` |
| Date and time | `11 Oct 2026, 14:32` 24-hour, viewer's local time. | `formatDateTime()` |
| On-chain timestamps | `14:32:07.482` with milliseconds, next to the finality time. | `formatTimestamp()`, `<Timeline>` |
| Finality | `Final in 482 ms` under one second, `Final in 1.24 s` above. | `formatFinality()` |
| Countdowns | `4d 06h 12m 09s` segments in headers, `4d 6h` inline in tables (inline never ticks seconds unless `showSeconds` is set). Amber under 24h. After the target, either "Ended" or counting up with a `+`. | `<Countdown target start label />` |
| Durations | `3.2 seconds`, `7 days`, `2 days 4 hours`. | `formatDuration()`, `formatDays()` |
| Relative time | `3 min ago`, only for activity feeds; never instead of a date on money events. | `formatRelative()` |
| Percent | `23%`, no decimals unless below 1%. | `formatPercent()` |

---

## 7. Container status system

`StatusPill` takes a `state` key. Keys, labels, tones and icons live in `web/src/lib/ui/status.ts` (`STATUS`, `CONTAINER_STATES`). Backend state values should use these exact keys.

| Key | Pill label | Long label (`long`) | Tone | Icon (lucide) | Live |
|---|---|---|---|---|---|
| `requested` | Requested | Release requested | neutral | circle-dashed | |
| `awaiting_deposit` | Awaiting deposit | Awaiting deposit | warning | hourglass | |
| `deposit_held` | Deposit held | Deposit held by protocol | protocol | shield-check | |
| `authorized` | Authorized | Authorized, deposit-free | protocol | key-round | |
| `released` | Released | Release order issued | info | door-open | |
| `in_free_time` | In free time | In free time | success | timer | yes |
| `in_detention` | In detention | In detention | caution | alarm-clock | yes |
| `returned` | Returned | Empty returned | info | package-check | |
| `settling` | Settling | Settling | protocol | scale (spins) | yes |
| `settled` | Settled | Settled and refunded | success | circle-check | |
| `disputed` | Disputed | Charges disputed | danger | flag | |
| `pending_onchain` | Pending on-chain | Pending on-chain | neutral | loader (spins) | yes |

Rules: color, icon and label always travel together. Use `long` in page headers and toasts, short in tables. Use `label` to add a figure: `<StatusPill state="authorized" label="Authorized: up to $150.00 per day" />`. Never show `settled` or a refund amount until the settlement transaction is final.

---

## 8. Tempo feature labels (`TempoTag`)

The demo requires every Tempo feature to be named on screen where it works. `TempoTag` is the only way to do that.

```svelte
<TempoTag feature="virtual_address" />                       <!-- inline chip with TIP-1022 -->
<TempoTag feature="access_key" label="Access key: up to $150.00 per day, payable only to Northgate Lines, expires 28 Oct 2026" />
<TempoTag feature="receive_policy" variant="callout" detail="Deposits land in the guard, not in your balance." />
<TempoTag feature="fee_sponsored" size="sm" flash />          <!-- flash once when the feature just fired -->
```

Props: `feature` (registry key), `label` (override text, for dynamic amounts and dates), `tip` (override TIP number; `null` hides it), `description`, `href`, `variant` (`tag` | `callout`), `detail` (callout line), `children` (callout body), `size` (`sm` | `md`), `flash`.

Anatomy: diamond-and-dot glyph, label, hairline divider, mono TIP number. Petrol tone. It is a focusable button; hover or focus opens a rich tooltip with the feature title, a plain-words description, the line "On Tempo this is part of the protocol; elsewhere it would be custom contract code.", and a docs link. Escape closes it.

| Key | Default label | TIP |
|---|---|---|
| `virtual_address` | Virtual address per container | TIP-1022 |
| `receive_policy` | Receive policy: funds in the protocol guard, not the line's balance | TIP-1028 |
| `held_not_lost` | Held, not lost | TIP-1028 |
| `recovery_authority` | Settlement contract = recovery authority | TIP-1028 |
| `access_key` | Access key | |
| `recurring_limit` | Recurring limit enforced by the protocol, not by our app | |
| `key_revoked` | Access key revoked | |
| `memo` | Memo: container and B/L number | TIP-20 |
| `batch` | Batch transaction | |
| `fee_sponsored` | Fee sponsored, no gas | |
| `passkey` | Passkey | |
| `finality` | Final in about 0.5 s | |
| `refund_seconds` | Refund in seconds | |

Only use TIP numbers that appear in `details.md`. Placement: next to the thing it explains (beside generated addresses, beside the pay button, in the memo trail header), never in page titles, at most one per feature per view. Use `variant="callout"` once per page for the headline feature of that page.

---

## 9. Components

Import from the barrel: `import { Button, StatusPill, TempoTag } from '#lib/ui';` (SvelteKit 3 uses `#lib`, not `$lib`). Icons: `import KeyRound from '@lucide/svelte/icons/key-round';` (per-icon imports keep dev fast), passed as components: `<Button icon={KeyRound}>`. Icon stroke 1.75, size 14 to 16 in UI.

| Component | Purpose and key props |
|---|---|
| `Button` | `variant` primary (ink) / accent (protocol action) / secondary / ghost / danger; `size` sm/md/lg; `icon`, `iconEnd`, `leading` snippet; `loading`, `loadingLabel`; `href` renders a link; `fullWidth`. |
| `IconButton` | `icon`, `label` (required; aria-label and tooltip), `variant` ghost/secondary, `size`, `pressed`. |
| `Field` | Wraps one control: `label`, `hint`, `error`, `required`, `disabled`, `aside` snippet (for a TempoTag), `hideLabel`. Provides id and aria wiring to the control inside. |
| `Input` | `bind:value`, `prefix` ("$"), `suffix` ("USD", "days"), `icon`, `trailing` snippet, `mono` (identifiers), `numeric` (right aligned tabular), `size`, `invalid`. |
| `Select` | Native select, `options` [{value,label}], `bind:value`, `placeholder`. |
| `Textarea` | `bind:value`, `maxlength` with `showCount`. |
| `Checkbox` | `bind:checked`, `label`, `description`, `indeterminate`. |
| `Switch` | `bind:checked`, `label`, `description`, `onchange`. role=switch. |
| `SegmentedControl` | Radiogroup with arrow keys. `options` [{value,label,description,icon}], `bind:value`, `label` (required), `variant` pill / cards. Use `cards` for **Held deposit vs Deposit-free**. |
| `Card` | `title`, `description`, `actions` snippet, `header`, `footer`, `padding` none/sm/md/lg, `variant` default/sunken/outline, `interactive`. Header actions wrap under the titles when space runs out (never squeeze the description). Descriptions are sentences and end with a period. Every section of a page is a Card with a title (no free-standing `h2` section headings); tables inside cards use `padding="none"` and `framed={false}`. Padding drops to 16 on phones. |
| `Stat` | KPI tile: `label`, `value` (pre-formatted) or `valueSnippet`, `unit`, `delta` {value, direction, sentiment, context}, `hint`, `icon`, `sparkline` number[], `footer` snippet (put the data-source TempoTag here), `loading`, `href`. Tiles in a row share one height and the footer sits on the bottom edge. Keep labels to one line at four-up (about 28 characters); put the longer explanation in `hint`. |
| `Sparkline` | Single-series trend line; `values`, `label`. |
| `Table` | Generic: `columns` [{key,label,numeric,align,width,hideBelow}], `rows`, `rowKey`, `cell` snippet (row, column), `caption` (required), `rowHref` + `rowLabel` (stretched row link), `loading`, `empty` snippet or `emptyTitle`/`emptyDescription`/`emptyIcon`, `density`, `stickyHeader`, `highlight` (flash a changed row). |
| `Badge` | `tone`, `dot`, `pulse`, `icon`, `variant` soft/outline, `mono`, `size`. |
| `StatusPill` | `state` (see section 7), `long`, `label`, `size` sm/md/lg. |
| `TempoTag` | See section 8. |
| `Tooltip` | Wraps a focusable trigger. `text` or `content` snippet, `placement`, `variant` plain/rich, `interactive`. Opens on hover and focus, Escape closes, uses the Popover API (top layer). |
| `Modal` (alias `Dialog`) | Native `<dialog>`: focus trap, Escape, backdrop click. `bind:open`, `title`, `description`, `size`, `footer` snippet, `dismissible` (set false while a passkey prompt is open), `media` snippet. Bottom sheet on mobile. |
| `Drawer` | Same API, slides in from the right. Use for container quick views. |
| `Tabs` | `items` [{value,label,count,icon}], `bind:value`, `label`, `variant` underline/pill, `panel` snippet receiving the active value. Arrow keys, Home, End. |
| `toast` + `Toaster` | `toast.protocol(title, {description, txHash, href, finalityMs})`, `toast.success`, `toast.error`, `toast.warning`, `toast.show`. `<Toaster />` is already in the root layout. Use `protocol` when an on-chain event lands. |
| `Skeleton` | `width`, `height`, `lines`, `circle`. |
| `EmptyState` | `icon`, `title`, `description`, `actions` snippet, `compact`, `tone="error"`. |
| `Countdown` | `target`, `start` (shows progress), `label`, `elapsedLabel`, `countUp`, `warnWithin`, `variant` segments/inline, `size`, `showSeconds`, `showTarget`, `onElapsed`. Ticks every second. |
| `Meter` | Detention accrued vs deposit: `value`, `max`, `dailyRate` (day ticks and "covers N more days"), `label`, `maxLabel` ("deposit", or "maximum" for deposit-free), `live`, `compact`. Turns orange at 75%, red at 100%. role=meter. |
| `Timeline` | Memo trail: `entries` (TimelineEntry: id, kind, title, timestamp, amount, memo, txHash, href, finalityMs, status confirmed/pending/failed, actor, detail), `order`, `hideMemos`. New entries animate in. Kinds: request, deposit, authorization, release, pull, refused, return, charge, settlement, refund, revocation, held, dispute, note. |
| `Hash` (alias `Address`) | `value`, `kind` address/tx/key, `label`, `href`, `head`, `tail`, `full`, `copyable`. |
| `Money` | `amount` (number USD, or bigint base units with `decimals`), `unit`, `size` xs/sm/md/lg/xl/display, `tone` default/muted/positive/negative/protocol, `signed`, `dimCents`, `compact`. |
| `ContainerNumber` | `value`, `type`, `size`, `copyable`, `href`, `validate`. |
| `PasskeyButton` | `state` idle/waiting/success/error, `label`, `sublabel`, `glyph` face/fingerprint, `variant` primary/secondary, `fullWidth`, `href`, `onclick`. |
| `AppShell` | See section 10. |
| `PageHeader` | `title`, `titleSnippet` (e.g. a ContainerNumber), `subtitle`, `breadcrumbs` [{label,href}], `meta` snippet (status, tags, facts), `actions` snippet, `divider`. Desktop: actions on the right of the titles; phones: titles, then meta (status first), then actions. Breadcrumb labels for containers use `formatContainerNumber` (`MRDU 482662-1`), never the raw number. |
| `Logo` | `variant`, `size`, `tone`, `label`. |
| `NetworkBadge`, `LiveIndicator`, `ThemeToggle`, `Spinner` | Shell furniture; also usable on their own. |
| `SeriesChart` (`#lib/app`) | Dashboard trend: `kind` area (running totals, e.g. cash held) or bars (per-day sums, e.g. refunds). Area shows the top of the scale; sparse bar series (four active days or fewer) label each bar with its amount and keep a faint stub for every empty day, so one refund in thirty days still reads as a timeline, not a stray bar. |

Accessibility contract (already built in, do not undo it): visible focus ring on every interactive element, labels for every control (Field or `label` prop), icon-only buttons need `label`, `aria-live` on copy confirmations and toasts, tables need `caption`, keyboard support for Tabs, SegmentedControl, Modal, Drawer, Tooltip and the org menu, AA contrast in both themes, reduced motion respected.

---

## 10. App shell

```svelte
<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { AppShell } from '#lib/ui';
</script>

<AppShell
  role={currentRole}                       // 'line' | 'importer'
  onRoleChange={(r) => goto(r === 'line' ? '/line' : '/importer')}
  org={currentOrg} orgs={myOrgs} onOrgChange={switchOrg}
  path={page.url.pathname}
  live={connectionState}                   // 'live' | 'connecting' | 'offline' from Convex
  user={{ name, email }}
>
  ...page
</AppShell>
```

- **Sidebar (240px):** logo; nav per role from `DEFAULT_NAV` in `nav.ts` (override with `nav`); footer note "Network fees sponsored by Portunus". Active item: white surface, hairline, petrol icon. Badges for counts (open disputes, held transfers).
  - Line: Dashboard `/line`, New release request `/line/requests/new`, Containers `/containers`; Settlement: Returns and settlement `/line/returns`, Held transfers `/line/held`, Disputes `/disputes`; Account: Settings `/line/settings`.
  - Importer: Dashboard `/importer`, Release requests `/importer/requests` (pay deposits `/importer/requests/[id]`, authorize deposit-free on the same route when the mode is deposit-free), Containers `/containers`; Settlement: Disputes `/disputes`.
  - Container detail: `/containers/[number]` for both roles. Sign in: `/signin`.
- **Top bar (56px, sticky, translucent):** org switcher (avatar initials, name, role and port; opens a menu), then on the right: "Demo view" role switch (Line | Importer), live indicator, **one** network indicator, theme toggle, notifications, user menu. The network indicator is passed as AppShell's `network` snippet (the app passes `ChainBadge`): it says `Simulated chain` (dashed edge, amber glyph; tooltip names Tempo Moderato and the `sim:` hashes) or `Tempo Moderato testnet` in live mode, `Sim` / `Testnet` on phones. Never show a second network or chain badge next to it.
- **Tablet:** sidebar becomes a 64px icon rail; labels appear on hover/focus; the default `NetworkBadge` hides (a `network` snippet stays visible, in short form).
- **Mobile:** sidebar hidden; top bar shows the logo, live dot, the short network indicator and a menu button; the menu drops down with nav, org list, role switch, network indicator and theme toggle. It closes on navigation and Escape.
- **Demo controls (sim only):** docked at the bottom of the sidebar on desktop (sidebar width, product clock on the right; the sidebar footer reserves the room), a round icon button on tablet (in the rail) and phone (bottom right).
- **Content:** max 1280px, padding 32 (desktop), 24 (tablet), 16 (mobile). Every page starts with `PageHeader`.

---

## 11. Page specifications

Common to every app page: AppShell, then PageHeader (breadcrumbs only on detail pages), then content. Loading: skeletons shaped like the final content (Stat `loading`, Table `loading`, `Skeleton lines`), never a full-page spinner. Errors: inline `EmptyState tone="error"` in the affected card with a retry, plus `toast.error` for failed actions. Anything waiting on Tempo shows `pending_onchain`, never optimistic success.

### 11.1 Landing `/` (built)

The reference implementation is `web/src/routes/+page.svelte`. Section order: sticky top nav (logo, section links, network badge, theme toggle, Sign in); hero (eyebrow, display headline, lead from the one-line summary, "Sign in with a passkey" and "See the evidence", three proof points, live product preview card of a container with its deposit held, free-time countdown, detention meter, memo trail, and a floating "Refunded" card over an abstract harbour-gate line drawing); 01 The problem (section 3 copy, two parties); 02 Evidence (four separate headline figures, then the full evidence table, every row with its source link, then the honest gaps note); 03 Why existing fixes fall short (four cards); 04 How it works (Held deposit vs Deposit-free comparison, clean-returns note, five-step flow, each step with its TempoTag); 05 Why Tempo (ink band: headline, "elsewhere it would be custom contract code" lede, four feature cards A Access keys, B Receive policies and the guard TIP-1028, C Virtual addresses TIP-1022, D Memos, batch, fee sponsorship, passkeys, each with a small working visual and an "Elsewhere:" line, then the docs links); 06 Settlement rules (seven numbered rules); passkey CTA card; footer. Section anchors: `#problem`, `#evidence`, `#alternatives`, `#how`, `#why-tempo`, `#rules` (the demo video opens on `#why-tempo`).

### 11.2 Sign in `/signin`

No AppShell. Centered column, max 400px, on `--color-bg` with the landing's faint arch drawing behind (optional).
1. Logo (full, 24px), link to `/`.
2. Title "Sign in to Portunus" (`--text-2xl`), one line: "Use the passkey on this device. No passwords, no seed phrases."
3. `PasskeyButton fullWidth` (states: idle, waiting while the OS sheet is open, success then redirect, error with retry). Below it, `TempoTag feature="passkey"`.
4. Divider, then "New to Portunus?" with a secondary `PasskeyButton variant="secondary" label="Create a passkey"` and a short `Field` for organization name and role (Shipping line | Importer as `SegmentedControl`) shown only in the create flow.
5. Footer: `NetworkBadge`, "Fees are sponsored. You never need gas."
Errors: passkey cancelled shows `state="error"` with "Not completed. Try again"; unsupported browser shows an inline EmptyState with guidance. After sign in, route to `/line` or `/importer` by role.

### 11.3 Line: settings `/line/settings`

PageHeader "Settings", subtitle "Deposits account, charges address and default terms." Content max 960px, two-column on desktop (left: section intro text 1/3, right: card 2/3), stacked on mobile.
1. **Deposits account** card. Read-only rows: deposits account `Hash`, receive policy status as `Badge tone="protocol" dot` "Active: deposits held by the guard", recovery authority = settlement contract `Hash`. `TempoTag feature="receive_policy" variant="callout"` and `TempoTag feature="recovery_authority"`. If not yet configured: EmptyState with a primary "Set up deposits account" button, then a progress list (Create account, Set receive policy, Set settlement contract as recovery authority), each row turning `pending_onchain` then done with `Final in N ms`.
2. **Charges address** card: `Hash`, explanation "Detention and approved charges are paid here. Access keys can pay only this address."
3. **Default terms** card: `Field` + `Input numeric suffix="days"` for free days; settlement window days with hint "3 by default. Set 15 to match the Philippines draft rule."
4. **Rate card** table: columns Container type (20GP, 40GP, 40HC, 45HC), Daily detention (Money input), Deposit (Money input), editable inline; Save button in card footer (primary), disabled until dirty.
5. **Deposit-free eligibility** card: Switch "Offer deposit-free after N clean returns" with numeric input.
Loading: skeleton rows. Errors: field-level errors via `Field error`.

### 11.4 Line: new release request `/line/requests/new`

PageHeader "New release request", breadcrumbs Dashboard / New release request. Content: form left (max 720px), sticky summary right (320px) on desktop; summary moves below on mobile.
1. **Importer** card: Select importer (shows track record as `Badge` "12 clean returns"); then `SegmentedControl variant="cards"` with Held deposit (icon shield-check, "The deposit moves into the protocol guard. For new or unknown importers.") and Deposit-free (icon key-round, "Nothing moves until a charge is owed. For importers with a clean record."). Deposit-free is disabled with a hint when the importer is not eligible. Under it the matching callout: `TempoTag feature="receive_policy" variant="callout"` or `feature="access_key" variant="callout"`.
2. **Bill of lading** card: B/L number (`Input mono`), port, vessel/voyage (optional).
3. **Containers** card: repeatable rows: container number (`Input mono`, validated with `isValidContainerNumber`, inline error "Check digit does not match"), size/type Select, free days, daily rate, deposit (prefilled from rate card, editable, `numeric`). "Add container" ghost button with plus icon. Row remove `IconButton`.
4. **Summary** (sticky Card): containers count, total deposit `Money size="xl"`, free days, settlement window, refund rule sentence. Primary button "Create request and generate addresses".
5. **After submit** (same page, success state): heading "Request sent to Adebayo Foods", `TempoTag feature="virtual_address" variant="callout"` with one row per container: `ContainerNumber` and its generated deposit address `Hash` (each row appears with a short stagger), the request link with copy, and "View containers". This is the demo shot for "Virtual address per container (TIP-1022)".
Errors: duplicate container number, invalid check digit, missing rate card (link to settings).

### 11.5 Importer: pay deposits `/importer/requests/[id]` (held mode)

PageHeader title "Release request NGLLOS2409171" (B/L in mono via `titleSnippet`), subtitle "From Northgate Lines, Apapa", meta: `StatusPill state="awaiting_deposit"`. Two columns: terms left, pay panel right (sticky).
1. **Terms** card: one row per container: `ContainerNumber` + type, deposit `Money`, free days, daily detention rate. Then the refund rule in plain words (from section 9, the first five rules) with a "Settlement rules" link.
2. **Pay panel** card: total `Money size="xl"`, token line `Money unit` showing the agreed stablecoin, account balance and "after payment" balance; partial coverage warning if balance is short ("Release stays blocked until each container is fully covered"). Tags in a row: `TempoTag feature="batch"`, `feature="fee_sponsored"`, `feature="memo"`. Then `PasskeyButton fullWidth label="Pay 3 deposits" sublabel="One transaction. Fees sponsored."`, with `TempoTag feature="passkey" size="sm"` below.
3. **After payment:** each container row flips to `StatusPill state="deposit_held" long` with `Final in N ms` and its tx `Hash`; a `toast.protocol("Deposit held by protocol", {finalityMs, txHash})`; callout `TempoTag feature="receive_policy" variant="callout"`. While waiting: `pending_onchain` per row.
Empty: request not found or already paid (EmptyState with link to the container list).

### 11.6 Importer: authorize deposit-free `/importer/requests/[id]` (deposit-free mode)

Same header, meta `StatusPill state="requested"`. One centered column, max 640px.
1. **What you are authorizing** card, a definition list in large type: Daily cap `Money size="lg"` "per day, resets daily"; Recipient "Northgate Lines charges address only" + `Hash`; Expiry `formatDate` with "end of free time plus the maximum detention days"; Token. A sentence: "No money moves now. The line can pull at most one day of detention per day after free time ends, and nothing to anyone else."
2. `TempoTag feature="access_key" variant="callout" label="Access key: up to $150.00 per day, payable only to Northgate Lines, expires 28 Oct 2026"`.
3. `PasskeyButton fullWidth label="Authorize with passkey"`.
4. After: `StatusPill state="authorized" label="Authorized: up to $150.00 per day"`, toast, and a secondary "Revoke key" danger button explained as ending the line's guarantee (confirm Modal).

### 11.7 Container detail `/containers/[number]` (both roles)

PageHeader: breadcrumbs Containers / number; `titleSnippet` = `ContainerNumber size="lg" type copyable`; subtitle "B/L NGLLOS2409171 · Northgate Lines to Adebayo Foods · Apapa"; meta `StatusPill long size="lg"` and mode `Badge` (Held deposit | Deposit-free); actions by role (line: Record return; importer: Dispute charges, Submit return receipt when the line is silent).
1. **Summary row** (3 Cards, equal): Free time `Countdown start target label="Free time ends in" showTarget`, switching to `elapsedLabel="In detention for" countUp` after; Detention `Meter value max dailyRate live` (held: max = deposit; deposit-free: max = maximum and label "Pulled so far"); Deposit `Money size="xl"` with where it is ("Held by the protocol guard" + `TempoTag feature="receive_policy" size="sm"`, or for deposit-free "Access key, $150.00 per day" + `TempoTag feature="access_key" size="sm"`).
2. **Tabs** "Memo trail" (default) | "Charges" | "Access key" (deposit-free only) | "Details".
   - Memo trail: Card with `Timeline` of every payment event (memo, tx `Hash` with explorer link, `Final in N ms`, millisecond timestamp), header `TempoTag feature="memo"`. A refused second pull appears as `kind="refused"` with `TempoTag feature="recurring_limit"` beside it (the demo moment).
   - Charges: table of posted charges (type, days, amount, status), disputed rows with `StatusPill state="disputed"`.
   - Access key: key id `Hash`, daily cap, recipient, expiry, period, revoked or not (`TempoTag feature="key_revoked"` once revoked).
   - Details: virtual deposit address `Hash` + `TempoTag feature="virtual_address"`, return receipt, settlement window end `Countdown`.
Live updates: new timeline entries slide in; changed values animate; `LiveIndicator` in the top bar. Loading: skeleton cards and 4 timeline skeleton rows.

### 11.8 Line: record return and settle `/line/returns`

PageHeader "Returns and settlement", subtitle "Record empty returns, post charges within the window, settle." Tabs: "Awaiting return" | "In settlement window" | "Settled".
1. **Table** of containers: ContainerNumber, importer, mode Badge, status, detention accrued, deposit, window ends (`Countdown inline`). Checkbox column for batch settle.
2. **Record return** Drawer (from a row): EIR number (`Input mono`), return date, depot; preview of charges: accrued detention (from the meter), damage amount input with hint "Cannot exceed the deposit, or the accrued detention plus the stated damage amount"; a split preview: "To Northgate Lines" vs "Refund to Adebayo Foods" as two `Money size="lg"` figures, with a thin two-segment bar.
3. **Settle** primary accent action (single or batch: "Settle 4 containers"). Tags: `TempoTag feature="recovery_authority"`, `feature="refund_seconds"`, `feature="key_revoked"` (deposit-free rows), `feature="batch"` when more than one.
4. After: rows show `settling` then `settled`, a toast "Settled: $450.00 to Northgate Lines, $1,550.00 refunded" with finality and hash.
Empty: "No returns waiting" EmptyState.

### 11.9 Held transfers `/line/held`

PageHeader "Held transfers", subtitle "Payments the guard did not accept: wrong token or unknown sender. Nothing is lost." Callout `TempoTag feature="held_not_lost" variant="callout"`.
Table: received (date time), from (`Hash`), to deposit address (`Hash` + container), amount `Money unit` (token symbol shown, since it may be the wrong token), reason `Badge tone="warning"` (Wrong token | Unknown sender | Overpayment), action "Return to sender" (secondary). Returned rows move to a "Returned" tab with tx hash. Empty: EmptyState icon shield-check "No held transfers".

### 11.10 Disputes `/disputes` (both roles)

PageHeader "Disputes"; Tabs "Open" (count) | "Resolved". Table: container, raised by, disputed amount `Money`, undisputed amount already settled, reason (truncated), window or resolver deadline, status Badge. Row opens a Drawer: the charge breakdown, reason text, evidence list, timeline (`kind="dispute"`), and actions by role: importer "Withdraw dispute"; line "Accept and refund" / "Keep charge" (sends to resolver); resolver decision shown with `Badge`. Copy rule: "Disputed funds stay held. Undisputed funds settle immediately." with `TempoTag feature="recovery_authority"`. Importer can open a dispute only from the container page (once, inside the window), via a Modal with amount (cannot exceed posted charges) and reason (`Textarea maxlength 500 showCount`).

### 11.11 Importer dashboard `/importer`

PageHeader "Dashboard", subtitle "Your deposits, refunds and containers." Order:
1. **KPI row** (4 `Stat`): Cash currently held (Money, sparkline), Cash freed this month (delta vs last month), Average time from return to refund (seconds, the demo close shot; footer `TempoTag feature="refund_seconds" size="sm"`), Containers in free time or detention (count with a split hint "5 in free time, 1 in detention").
2. **Needs action** Card (only if any): release requests awaiting payment or authorization, each with total and a primary "Review" button.
3. **Containers** Table: ContainerNumber, line, status, free time `Countdown inline`, detention, deposit; row link to detail. Filter `SegmentedControl` All | In free time | In detention.
4. **Recent refunds** Card: last 5 settlements: container, refunded `Money tone="positive"`, return to refund time, tx `Hash`.
Footer note: "Reads from memos and settlement events." Empty (new account): EmptyState "No containers yet" with "Copy my payer address".

### 11.12 Line dashboard `/line`

PageHeader "Dashboard", actions: primary "New release request". Order:
1. **KPI row** (4 `Stat`): Deposits held (sum in the guard; footer `TempoTag feature="receive_policy" size="sm"`), Deposit-free exposure (sum of remaining daily caps times days; footer `TempoTag feature="access_key" size="sm"`), Containers past free time (count), Detention collected this month.
2. **Refunds due** Card, the compliance view: table of returned containers with refund deadline `Countdown inline` (amber within 24h), amount to refund, and a compliance Badge ("On time" success, "Due today" warning). Header copy: "Every refund is automatic at the end of the window."
3. **Containers in detention** Table with `Meter compact` per row (accrued vs deposit).
4. **Release requests** Table: B/L, importer, mode, containers, status (`awaiting_deposit`, `deposit_held`, `authorized`), created.
Footer note: "Reads from guard and access-key state."

---

## 12. Do and do not

- Do use `variant="accent"` for exactly one protocol action per view; everything else is primary, secondary or ghost.
- Do keep the memo text exactly as on-chain, in mono, inside the sunken memo block.
- Do show finality time on every confirmed on-chain event.
- Do not show amounts without `<Money>` or `formatMoney`.
- Do not create new colors, shadows or radii in page styles. Page-level CSS should be layout only (grid, gap, width).
- Do not use `$lib`; this project uses `#lib`.
- Do not use em dashes in UI copy.
- Do not add Tailwind or another component library.
