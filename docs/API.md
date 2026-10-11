# Portunus backend API (frontend reference)

Source of truth is the code in `web/src/convex/`. This is a summary written by the backend engineer. Import `api` from `web/src/convex/_generated/api.js` and call via `#lib/backend` (`useAuthedQuery`, `useAuthedMutation`, `useAuthedAction`, which inject `sessionToken`).

## Conventions
- Money: every `*Units` field is an integer base-unit string (1 USD = 1,000,000). Use `toUnits/fromUnits/formatUsd` from `src/lib/shared/domain` or `<Money>` from `#lib/ui`.
- Time: all timestamps ms (including `periodEnd`, key `expiry`). Product time in sim = `system.status().simNow` (real now + `simClockOffsetMs`). Countdowns must add `simClockOffsetMs`.
- Errors: `ConvexError` with `data = { code, message, ...extra }`. Codes: UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, INVALID, INVALID_CONTAINER, INVALID_STATE, CONFLICT, NOT_SUPPORTED, DEMO_DISABLED, APPROVAL_REQUIRED, INSUFFICIENT_BALANCE, WINDOW_OPEN, WINDOW_CLOSED, CHARGE_TOO_HIGH, CHAIN_ERROR, NOT_ELIGIBLE. Other org's data reads as NOT_FOUND.
- Approval (`deposits.payBatch` / `accessKeys.authorize`): `{ method: 'passkey'|'demo', credentialId?, payloadHash?, assertion? }`. `payloadHash` from `deposits.preview` / `accessKeys.prepare` is the WebAuthn challenge. `assertion = { authenticatorData, clientDataJSON, signatureR, signatureS, userVerificationRequired? }`. Demo personas send `method:'demo'`.

## system / auth
- `system.status()` -> `{ chainMode, chainId, network, explorerUrl|null, settlementToken, settlementTokenSymbol, simClockOffsetMs, simNow, demoMode, seeded, sponsorUrl|null }`
- `auth.createChallenge()` (mutation) -> `{ challenge }`
- `auth.registerPasskey({ name, email?, orgName, orgKind:'line'|'importer', country, credentialId, publicKey, address })` -> `{ sessionToken }`
- `auth.signInWithPasskey({ credentialId, challenge, authenticatorData, clientDataJSON, signatureR, signatureS, userVerificationRequired? })` -> `{ sessionToken, verified }`
- `auth.passkeyPublicKey({ credentialId })`, `auth.listDemoPersonas()` -> `[{ userId, name, title, orgName, orgKind, country, blurb }]`, `auth.signInAsDemo({ userId })` -> `{ sessionToken }`, `auth.me({ sessionToken? })` -> `{ user, org, approvedWith, verified } | null`, `auth.signOut`

## orgs / rate cards
- `orgs.listImporters` -> per importer `{ orgId, name, shortCode, country, tempoAddress, relationship:{defaultMode, cleanReturns, lateReturns, disputes}|null, openDisputes, cleanReturnsForDepositFree, suggestedMode:'held'|'depositFree', activeContainers, totalContainers }`
- `orgs.listLines` (importer view)
- `orgs.lineSettings` -> `{ org, chainMode, settlementWindowDays, cleanReturnsForDepositFree, maxDetentionDays, silentGraceHours, depositsAccount, chargesAddress, settlementContract, masterId, masterRegistered, receivePolicy, provisioned, resolver, resolverChoices, rateCards }`
- `orgs.updateLineSettings({ settlementWindowDays?, cleanReturnsForDepositFree?, maxDetentionDays?, silentGraceHours?, resolverOrgId?, chargesAddress? })`, `orgs.configureReceivePolicy()`
- `rateCards.list`, `rateCards.upsert({ containerType, freeDays, dailyRateUnits, depositUnits })`

## releaseRequests
- `create({ importerOrgId, billOfLading, vessel?, voyage?, portOfDischarge, mode, containers:[{number,type}] })` -> `{ requestId, requestCode, containerIds }` (ISO 6346 validated; virtual address per container). `mode:'depositFree'` is refused with `NOT_ELIGIBLE` unless the importer has the line's threshold of clean returns and no open disputes (same rule as `orgs.listImporters` `suggestedMode`)
- `get({ requestId? | requestCode? })` -> `{ request, line, importer, containers: ContainerView[], terms, totals:{depositUnits, receivedUnits, missingUnits, dailyRateUnits, containersTotal, containersCovered}, payerAddress, balanceUnits|null } | null`
- `listForLine`, `listForImporter` -> summaries with `containerCount, byState, depositTotalUnits, receivedTotalUnits`
- `issueReleaseOrder({ requestId })` (line) -> `{ released: Id[], blocked: [{ containerId, number, reason, missingUnits? }] }`

## deposits
- `preview({ requestId, amountOverrides? })` (query) -> `{ requestId, payer, mode, items:[{containerId, number, type, to, amountUnits, depositUnits, receivedUnits, missingUnits, memo, memoHex}], totalUnits, payloadHash, balanceUnits, sufficientBalance }`
- `payBatch({ requestId, approval, amountOverrides?, txHash? })` (action) -> `{ mode, txHash, blockNumber, timestamp, finalityMs, totalUnits, allCovered, containers:[{containerId, number, receivedUnits, depositUnits, missingUnits, state}] }`
- `recordLiveBatch({ requestId, txHash })` (action)

## accessKeys
- `prepare({ requestId })` (action) -> `{ requestId, mode, payloadHash, keys:[{containerId, number, keyAddress, token, dailyLimitUnits, periodSec, recipient, expiry, account}] }`
- `authorize({ requestId, approval, liveTxHashes? })` (action) -> `{ requestId, authorized:[{containerId, number, keyAddress, dailyLimitUnits, recipient, expiry, txHash, finalityMs}], failed:[...] }`
- `revoke({ containerId })` (action) -> `{ revoked, txHash|null, midFlight }`

## containers
- `get({ containerId })` -> `{ container: ContainerView, request, line, importer, terms, payments, events, accessKey, dispute, preview, simNow }`
  - `ContainerView` = container + `receivedUnits, missingUnits, covered, pendingOnChainFlag, requestCode, billOfLading, lineName, importerName, accessKey (public), escrowUnits`
  - `payments` = memo trail in time order (+ `displayHash` with `sim:` prefix, `explorerUrl`); failed attempts (refused pull) have `status:'failed'`, `txHash:''`
  - `events` = lifecycle `{kind, title, detail, at, actor}`
  - `preview` = `{ detentionDays, accruedUnits, damageUnits, maxChargeUnits, refundUnits, pulledUnits, uncollectedUnits }`
- `listForLine`, `listForImporter({ filter?:{ states?, mode?, requestId?, search? } })` -> `ContainerView[]`
- `recordReturn({ containerId, eirNumber, date?, depot })` (line), `submitReturnReceipt(...)` (importer, silent-line rule), `contestReturnReceipt({ containerId, note? })` (line)
- `postCharges({ containerId, damageUnits?, note?, settleNow? })` (action) -> `SettleOutcome { containerId, number, status:'settled'|'disputed'|'posted'|'failed'|'skipped', chargeUnits?, refundUnits?, disputedUnits?, txHash?, finalityMs?, revokePending?, cappedByDeposit?, reason?, code? }`
- `acceptCharges({ containerId })` (importer action), `settleMany({ containerIds })` (action) -> `{ outcomes, settled, skipped, txHash|null, finalityMs|null }`, `triggerSettlement({ containerId })` (either; WINDOW_OPEN before window end)

## disputes
- `open({ containerId, disputedUnits, reason, evidence? })` (importer action), `resolve({ disputeId, toLineUnits, note })` (resolver action -> `{ disputeId, toLineUnits, toImporterUnits, txHashes, finalityMs|null }`), `list({ status? })` (rows incl. `containerNumber, importerName, lineName, escrowUnits, canResolve, decision`), `get({ disputeId })`

## other
- `heldTransfers.list({ status? })`, `heldTransfers.returnToSender({ heldTransferId })` (action -> `{ heldTransferId, txHash, finalityMs }`)
- `dashboard.importer` -> `{ now, cashHeldUnits, cashFreedThisMonthUnits, cashFreedTotalUnits, avgReturnToRefundMs|null, refundCount, awaitingDeposit, inFreeTime, inDetention, awaitingSettlement, disputed, settled, containersTotal, depositFree:{activeKeys, dailyCapTotalUnits}, detentionPaidUnits, upcoming, recent, series:{cashHeldPerDay, refundsPerDay} }` (series: 30 x `{ day, t, valueUnits }`)
- `dashboard.line` -> `{ now, depositsHeldUnits, depositFreeExposureUnits, depositFreeUncollectedUnits, activeKeys, dailyCapTotalUnits, pastFreeTime, inFreeTime, awaitingDeposit, awaitingAuthorization, readyToRelease, awaitingSettlement, settled, detentionCollectedUnits, detentionCollectedLast30Units, refundsDue:[{containerId, number, importerName, deadline, amountUnits, overdue}], overdueRefunds, heldTransfers:{count, units}, openDisputes, compliance:{settledCount, avgReturnToRefundMs, maxReturnToRefundMs, settlementWindowDays}, recent, series }`
- `notifications.list({ limit?, unreadOnly? })` -> `{ unread, items }`, `notifications.markRead({ ids? })`

## demo (sim)
- `demo.advanceClock({ ms })`, `demo.jumpToFreeTimeEnd({ containerId })`, `demo.sendStrangerTransfer({ lineOrgId, token:'BetaUSD'|'AlphaUSD' })`, `demo.trySecondPull({ containerId })` -> `{ refused:true, error:'SpendingLimitExceeded', remainingUnits, periodEnd, attemptedUnits, day }`, `demo.reset()`

## Behaviour notes
- Release: `deposit_held`/`authorized` -> `released` -> `in_free_time` in one mutation.
- Detention days = floor((min(now, returnedAt) - freeTimeEnd)/day) + 1, capped at maxDetentionDays; accrued = min(days x rate, deposit).
- `postCharges` settles immediately by default; `settleNow:false` posts for importer review (accept or dispute).
- Disputes only in held mode, once, while `returned` and window open.
- Silent line: importer can submit a receipt once the return date is >= `silentGraceHours` (default 24h) old; the line's value is in `terms.silentGraceHours` on `containers.get`, `containers.byNumber` and `releaseRequests.get`.
- Live revocation after deposit-free settlement: pending until importer revokes with passkey (`revokeRequestedAt`).
