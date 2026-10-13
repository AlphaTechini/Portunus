# Portunus: architecture contract

This is the contract every coding agent follows. Product truth is `details.md`. Tempo API truth is `docs/research/tempo-integration.md` (the brief). Visual truth is `docs/design/DESIGN.md` plus the components in `web/src/lib/ui/`. When this file and the brief disagree on a Tempo detail, the brief wins. When they disagree on structure or naming, this file wins.

## 1. Repository layout and ownership

```
web/                          SvelteKit 3 + Svelte 5 app (runes only), TypeScript, no Tailwind
  convex.json                 { "functions": "src/convex/" }
  src/convex/                 Convex backend (schema, queries, mutations, actions, crons)   [owner: BACKEND]
    tempoNode.ts              "use node" live Tempo actions                                  [owner: TEMPO-LIVE]
  src/lib/shared/             Pure TS shared by Convex and the browser (no $lib, no $env, no Node APIs)
    domain/                   rules, money, container numbers, memos, state machine        [owner: BACKEND]
    tempo/adapter.ts          TempoAdapter interface + error classes (from brief §11)        [owner: BACKEND]
    tempo/sim.ts              Sim chain logic operating on Convex tables                     [owner: BACKEND]
    tempo/live/*.ts           Live helpers usable by both node actions and browser           [owner: TEMPO-LIVE]
    tempo/settlementAbi.ts    ABI + bytecode of PortunusSettlement                           [owner: TEMPO-LIVE]
  src/lib/tempo/              Browser-only Tempo code (passkeys, browser live signing)       [owner: TEMPO-LIVE]
  src/lib/backend/            Backend client facade (Convex cloud OR in-browser runtime)     [owner: RUNTIME]
  src/lib/ui/                 Design system components and tokens                            [owner: DESIGN]
  src/routes/                 Pages                                                          [owner: FRONTEND]
  scripts/                    Node scripts: compile contract, one-time live setup            [owner: TEMPO-LIVE]
contracts/PortunusSettlement.sol                                                             [owner: TEMPO-LIVE]
docs/                         research, design, this file
```

Rules for everyone:
- Convex functions import shared code via relative paths only (`../lib/shared/...`). Never `$lib` or `$env` inside `src/convex/`.
- Svelte 5 runes only (`$state`, `$derived`, `$effect`, `$props`, snippets). No `export let`, no `on:click` (use `onclick`).
- No em-dashes in user-facing copy.
- Money is always integer base units (`bigint` in TS logic, stored as a decimal **string** in Convex because Convex has no bigint-friendly numeric indexes; use `v.string()` and helpers `toUnits`/`fromUnits`/`formatUsd` in `shared/domain/money.ts`). AlphaUSD has 6 decimals.
- Timestamps are ms since epoch (`number`).
- Never commit secrets. `.env*` and `.state/` are gitignored.

## 2. Modes

Two independent switches.

**Backend mode** (decided in the browser by `src/lib/backend`):
- `convex`: `PUBLIC_CONVEX_URL` is set. Uses `convex-svelte` against a real Convex deployment.
- `local`: `PUBLIC_CONVEX_URL` is unset. The same `src/convex/*.ts` modules run **inside the browser** in an in-memory runtime that emulates `ctx.db`, `ctx.scheduler`, `ctx.runQuery/runMutation/runAction`, and crons, persisted to `localStorage` and synced across tabs with `BroadcastChannel`. This makes the whole product demoable with no network and lets us test it here. `"use node"` files are excluded from the local runtime.
- SvelteKit here is **3.x**: `$lib` is removed. Import with package `imports` aliases: `#lib/ui`, `#lib/backend`, `#lib/...`. `browser`/`dev` come from `$app/env` (not `$app/environment`). Public env vars are declared in `web/src/env.ts` (`defineEnvVars`) and read from `$app/env/public`. `$env/*` modules are deprecated; do not use them.
- Files that must not run in the browser runtime are named `*Node.ts` (e.g. `tempoNode.ts`) and start with `"use node"`.

**Chain mode** (`TEMPO_MODE` Convex env, default `sim`; the local runtime is always `sim`):
- `sim`: chain behaviour simulated in Convex tables (`sim_*`), exactly per brief §11 "Sim behaviour spec". UI shows a persistent "Simulated chain" badge; sim tx hashes are displayed with a `sim:` prefix and have no explorer link.
- `live`: real Tempo Moderato calls via `tempoNode.ts` (server) and `src/lib/tempo/live.browser.ts` (passkey signing).
- Every `payments` row stores `mode`. Never mix.
- The public query `system.status` returns `{ backendMode is decided client side, chainMode, chainId, simClockOffsetMs, simNow }`.

## 3. Time

- `now(ctx)` in `shared/domain/clock.ts`-style helper inside Convex: in sim mode returns `Date.now() + sim_meta.clockOffsetMs`; in live mode `Date.now()`.
- All product time logic (free time, detention days, settlement windows, countdowns) uses this "product now". The browser gets `simClockOffsetMs` from `system.status` and adds it in countdowns.
- When scheduling: `ctx.scheduler.runAt(Math.max(Date.now(), targetProductTime - offset), ...)`.
- Demo controls (sim only): `demo.advanceClock({ ms })` bumps the offset and immediately runs the sweep so every due step (free time end, daily detention, settlement window end) executes. Presets in UI: +1 hour, +1 day, "jump to end of free time" for a container.

## 4. Auth and sessions

- Identity = user record linked to one organization and a role (`line` | `importer`). Platform role `platform` exists for the dispute resolver.
- Passkeys: per brief §5. Browser creates a WebAuthn credential (`WebAuthnP256.createCredential`), derives the Tempo address with `Account.fromWebAuthnP256`, and calls `auth.registerPasskey`. Sign-in uses `WebAuthnP256.getCredential` with a server challenge and `auth.signInWithPasskey` (verify the assertion with `ox`'s `WebAuthnP256.verify` if it runs in the default Convex runtime; otherwise accept and mark `verified: false`, demo-grade).
- Demo personas: seeded users without passkeys. `auth.signInAsDemo({ userId })` creates a session (allowed only when `DEMO_MODE` is not `"off"`; default on). The sign-in page shows the passkey button first and the personas below it.
- Session: random 32-byte token (hex) stored in `sessions`, returned to the client, kept in `localStorage` key `portunus.session`. **Every public function that touches org data takes `sessionToken: v.string()` as an argument** and resolves `{ user, org }` via `requireSession(ctx, token)`; throws `ConvexError({ code: 'UNAUTHENTICATED' })` otherwise.
- Approving a payment or authorization: if the user has a passkey, the browser does a real WebAuthn prompt over the payload hash (sim) or signs the real tx (live). Demo personas without passkeys see a passkey-styled confirm sheet ("Approve with passkey" with a simulated biometric animation). The server records `approvedWith: 'passkey' | 'demo'`.

## 5. Data model (Convex `schema.ts`)

All tables, fields and indexes. Agents may add fields/indexes but not rename these.

```
organizations   { kind: 'line'|'importer'|'platform', name, shortCode (e.g. 'MRDN'), country, tempoAddress?,
                  // line only:
                  depositsAccount?, chargesAddress?, settlementContract?, masterId?, receivePolicy?: {senderPolicy, tokenPolicy, recoveryAuthority, configuredAt},
                  settlementWindowDays?: number (default 3), cleanReturnsForDepositFree?: number (default 3), resolverOrgId? }
                  index by_kind
users           { orgId, name, email?, role: 'line'|'importer'|'platform', title?, demo: boolean, passkey?: { credentialId, publicKey, address } }
                  index by_org, by_credential (passkey.credentialId) -> store credentialId also top-level `credentialId?` for indexing
sessions        { token, userId, createdAt, expiresAt }  index by_token
challenges      { challenge, createdAt, used: boolean }  index by_challenge
rateCards       { lineOrgId, containerType: '20GP'|'40GP'|'40HC'|'20RF'|'40RF', freeDays, dailyRateUnits (string), depositUnits (string) }
                  index by_line
relationships   { lineOrgId, importerOrgId, defaultMode: 'held'|'depositFree', cleanReturns: number, lateReturns: number, disputes: number, resolverOrgId }
                  index by_line, by_importer, by_pair
releaseRequests { lineOrgId, importerOrgId, billOfLading, vessel?, voyage?, portOfDischarge, mode: 'held'|'depositFree',
                  status: 'awaiting_importer'|'active'|'completed'|'cancelled', createdBy, createdAt, requestCode (short public code for the link) }
                  index by_line, by_importer, by_code
containers      { requestId, lineOrgId, importerOrgId, number (ISO 6346, e.g. 'MRDU1234565'), type, mode,
                  seq: number (per-line sequence used for the virtual address), depositAddress (virtual address),
                  depositUnits, dailyRateUnits, freeDays, maxDetentionDays,
                  state: ContainerState, stateChangedAt,
                  releasedAt?, freeTimeEndsAt?, returnedAt?, returnReceipt?: { eirNumber, date, depot, submittedBy: 'line'|'importer', recordedAt },
                  settlementWindowEndsAt?, detentionDays: number, accruedUnits (string), pulledUnits (string),
                  chargesUnits?, damageUnits?, refundUnits?, settledAt?, heldReceiptId?, accessKeyId?,
                  pendingOnChain?: { step, since, attempts, lastError? }, scheduledJobId? }
                  index by_request, by_line_state, by_importer_state, by_number, by_deposit_address
payments        { kind: 'deposit'|'detention_pull'|'charge'|'refund'|'held_transfer'|'held_return'|'key_authorized'|'key_revoked'|'dispute_release',
                  mode: 'sim'|'live', containerId?, requestId?, lineOrgId?, importerOrgId?, from, to, token, amountUnits, memo (decoded text), memoHex,
                  txHash, logIndex?, blockNumber?, finalityMs, timestamp, status: 'pending'|'confirmed'|'failed', error? }
                  index by_container, by_line, by_importer, by_tx
accessKeys      { containerId, account (importer address), keyAddress, encPrivKey (server only, never returned by public queries), token,
                  dailyLimitUnits, periodSec: 86400, recipient, expiry, authorizedAt, revokedAt?, mode }
                  index by_container
heldTransfers   { lineOrgId, receiptId, receipt (hex), token, tokenSymbol, amountUnits, originator, recipient, memo, blockedAt,
                  reason: 'unknown_sender'|'wrong_token'|'excess', status: 'held'|'returned'|'matched', returnedTxHash?, containerId? }
                  index by_line_status
disputes        { containerId, openedBy (userId), importerOrgId, lineOrgId, disputedUnits, reason, evidence?, status: 'open'|'resolved',
                  resolverOrgId, decision?: { toLineUnits, toImporterUnits, note, decidedAt, decidedBy } , openedAt }
                  index by_container, by_line_status, by_importer_status
notifications   { orgId, userId?, kind, title, body, containerId?, createdAt, readAt? }  index by_org
jobRuns         { kind, containerId?, scheduledFor, ranAt?, ok?, error? }   (audit of scheduled work; used by the sweep)
sim_balances / sim_keys / sim_receipts / sim_events / sim_meta   per brief §11
```

`ContainerState` (shared/domain/states.ts), exact keys used by UI `StatusPill`:
`requested | awaiting_deposit | deposit_held | authorized | released | in_free_time | in_detention | returned | settling | settled | disputed`
plus the overlay flag `pendingOnChain` (rendered as "Pending on-chain").

State machine:
- create request -> each container `awaiting_deposit` (held) or `requested` (deposit-free, awaiting key authorization).
- held: deposit confirmed and fully covered -> `deposit_held` -> line issues release order -> `released` -> immediately `in_free_time` with `freeTimeEndsAt = releasedAt + freeDays*day`.
- deposit-free: key authorized -> `authorized` -> release -> `released` -> `in_free_time`.
- free time ends without return -> `in_detention`; detention accrues per started day (`detentionDays`, `accruedUnits = min(days*rate, depositUnits)` for held; for deposit-free, each day a pull of `dailyRate` is attempted via the access key).
- return recorded (by line, or by importer with the "silent line" rule) -> `returned`, `settlementWindowEndsAt = returnedAt + settlementWindowDays`.
- line posts final charges (<= deposit and <= accrued + stated damage) at any time inside the window, which settles immediately; or the window ends and the sweep settles with charges = accrued detention and no damage. Anyone can trigger an overdue settlement (`containers.triggerSettlement`).
- settlement -> `settling` while on-chain -> `settled` (held: charges to line, remainder refunded to importer in one tx; deposit-free: nothing to refund, key revoked (sim) / importer prompted to revoke (live, see brief §8)).
- importer may dispute posted charges once, inside the window: disputed amount stays held, undisputed part settles immediately; container `disputed` until resolver decides, then `settled`.

Partial payment: a container whose received deposit < required stays `awaiting_deposit` with `receivedUnits` shown. Overpayment: excess refunded at settlement.

## 6. Public API (Convex function names the frontend will call)

All take `sessionToken` unless marked public. Return plain JSON (money as strings).

```
system.status                       (public) chain mode, sim clock, network info
auth.createChallenge                (public) -> { challenge }
auth.registerPasskey                (public) { name, email?, orgName, orgKind, country, credentialId, publicKey, address } -> { sessionToken }
auth.signInWithPasskey              (public) { credentialId, challenge, signature fields } -> { sessionToken }
auth.passkeyPublicKey               (public query) { credentialId } -> publicKey | null
auth.listDemoPersonas               (public query) -> [{ userId, name, title, orgName, orgKind, blurb }]
auth.signInAsDemo                   (public) { userId } -> { sessionToken }
auth.me                             -> { user, org } | null
auth.signOut

orgs.listImporters                  (line) importers with relationship stats and suggested mode
orgs.lineSettings / orgs.updateLineSettings / rateCards.list / rateCards.upsert
releaseRequests.create              (line) { importerOrgId, billOfLading, vessel?, voyage?, portOfDischarge, mode, containers: [{ number, type }] } -> { requestId, requestCode }
releaseRequests.get                 { requestId } or { requestCode }  (both parties) -> request + containers + terms
releaseRequests.listForLine / listForImporter
releaseRequests.issueReleaseOrder   (line) { requestId } (only containers fully covered/authorized)
deposits.payBatch                   (importer, action) { requestId, approval } -> { txHash, finalityMs }   (sim: runs sim batch; live: browser already submitted -> confirmDeposits)
deposits.recordLiveBatch            (importer) { requestId, txHash }  (live path)
accessKeys.prepare                  (importer, action) { requestId } -> per container { keyAddress, dailyLimitUnits, recipient, expiry }
accessKeys.authorize                (importer, action) { requestId, approval, liveTxHashes? }
accessKeys.revoke                   (importer) { containerId }
containers.get                      { containerId } -> container + request + payments (memo trail) + accessKey public fields + dispute
containers.listForLine / listForImporter  { filter? }
containers.recordReturn             (line) { containerId, eirNumber, date, depot }
containers.submitReturnReceipt      (importer, silent-line rule) { containerId, eirNumber, date, depot }
containers.postCharges              (line, action) { containerId, damageUnits, note } -> settles
containers.settleMany               (line, action) { containerIds }   (batch settlement)
containers.triggerSettlement        (public with session, action) { containerId }  (anyone, only after window end)
disputes.open                       (importer) { containerId, disputedUnits, reason }
disputes.resolve                    (resolver/platform or line if resolver is line) { disputeId, toLineUnits, note }
disputes.list
heldTransfers.list / heldTransfers.returnToSender (line, action)
dashboard.importer                  -> { cashHeldUnits, cashFreedThisMonthUnits, avgReturnToRefundMs, inFreeTime, inDetention, recent... }
dashboard.line                      -> { depositsHeldUnits, depositFreeExposureUnits, pastFreeTime, detentionCollectedUnits, refundsDue: [{ containerId, number, deadline, amount }], ... }
notifications.list / notifications.markRead
demo.advanceClock                   (sim only) { ms } ; demo.jumpToFreeTimeEnd { containerId } ; demo.sendStrangerTransfer { lineOrgId, token: 'BetaUSD'|'AlphaUSD' } ; demo.reset (reseed)
demo.trySecondPull                  (sim/live) { containerId } -> shows chain refusal (SpendingLimitExceeded)
seed.ensure                         (public, idempotent) seeds demo data if the DB is empty
```

Internal (scheduled): `lifecycle.onFreeTimeEnd`, `lifecycle.dailyDetention`, `lifecycle.onWindowEnd`, `lifecycle.keyExpiryWarning`, `sweep.run` (daily cron + called by `demo.advanceClock`).

Chain orchestration (`src/convex/chain.ts`): mutations record intent first (`pendingOnChain`), then an action calls the adapter, then a mutation records the result (brief §11, details 14.4). In `sim` the action calls `sim.*` internal mutations; in `live` it calls `internal.tempoNode.*`.

Live node actions (owned by TEMPO-LIVE, called by BACKEND), all `internalAction` in `tempoNode.ts`:
```
tempoNode.health()                                        -> { ok, chainId, blockNumber }
tempoNode.fundFromFaucet({ address })                     -> TxResultJson[]
tempoNode.confirmDeposits({ txHash })                     -> HeldReceiptJson[]
tempoNode.createAccessKey()                               -> { keyAddress, encPrivKey }
tempoNode.pullDetention({ account, encPrivKey, to, amountUnits, memo }) -> TxResultJson | { error: 'SpendingLimitExceeded', remainingUnits, periodEnd }
tempoNode.getAccessKeyState({ account, keyAddress })      -> { remainingUnits, periodEnd, expiry, isRevoked }
tempoNode.settle({ items: [{ receipt, chargeUnits, disputedUnits, chargeMemo, refundMemo }] }) -> TxResultJson
tempoNode.resolveDispute({ receipt, toLineUnits, memo })  -> TxResultJson
tempoNode.returnHeldTransfer({ receipt })                 -> TxResultJson
tempoNode.listHeldReceipts({ depositsAccount, fromBlock }) -> { receipts: HeldReceiptJson[], toBlock }
```
`TxResultJson` = `{ mode: 'live', txHash, blockNumber: string, timestamp, explorerUrl, finalityMs }`. All bigint as decimal strings across the Convex boundary.

## 7. Seed data (fictional companies only, never real carriers)

- Line: "Meridian Ocean Lines" (shortCode MRDN, prefix MRDU), port agent persona "Adaeze Okafor, Import Desk Lead, Lagos (Apapa)". Rate cards: 20GP 7 free days, 45.00/day, deposit 1,200.00; 40GP 7 days, 75.00/day, 2,000.00; 40HC 7 days, 80.00/day, 2,200.00; 20RF 4 days, 120.00/day, 2,500.00; 40RF 4 days, 150.00/day, 3,500.00. Settlement window 3 days.
- Second line: "Kestrel Container Line" (KSTL, prefix KSTU), Mombasa.
- Importers: "Harbourview Foods Ltd" (Lagos; new; held mode), clearing agent persona "Tunde Bakare"; "Savanna Agro Traders" (Mombasa; 6 clean returns; deposit-free), persona "Wanjiru Mwangi"; "Pasig Valley Imports" (Manila; held), persona "Carlo Reyes".
- Platform org "Portunus Resolution Desk", persona "Resolution Desk".
- Historical activity so dashboards are not empty: ~14 settled containers over the past 60 days with realistic refund times (seconds in Portunus), 3 currently in free time, 2 in detention (one held, one deposit-free with pulls), 1 returned awaiting settlement window, 1 disputed, 2 held transfers (one BetaUSD wrong token, one unknown sender), and 1 release request awaiting the importer's deposit (3 containers, the demo-video scenario).
- All container numbers valid ISO 6346 (check digit computed by `shared/domain/containerNumber.ts`).
- Sim balances: each importer funded with 250,000.00 AlphaUSD in the sim ledger.

## 8. Testing

- Vitest + `convex-test` for backend logic (runs in Node; add as devDeps). Cover: state machine, accrual math, settlement caps, the 1-day limit refusal, dispute split, silent-line rule, idempotent settlement, sweep.
- `npx convex codegen --system-udfs --typecheck enable` must pass (brief §10).
- `pnpm check` and `pnpm build` in `web/` must pass with zero errors.
- Playwright E2E against the local runtime (FRONTEND phase).
