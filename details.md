# Portunus: details

Source of truth for what the product is, who uses it, which Tempo features it relies on, and how users move through it. Product only; no implementation instructions.

## 0. Name

Portunus is the Roman god of keys, doors and harbours. His symbol is a key. The product lives at the harbour gate, decides when a container may leave, and runs on Tempo access keys.

## 1. One-line summary

Shipping lines get guaranteed container deposits and detention charges, and importers stop locking cash for months: deposits are held by the Tempo protocol (or never move at all) and refunded the moment the empty container is back.

## 2. Why Tempo

Portunus is built on features that are part of the Tempo protocol itself, not contracts we wrote on top of a chain:

- Access keys with recurring, recipient-scoped, expiring spending limits let a shipping line hold a guarantee over an importer's account without any cash moving.
- Receive policies with the protocol guard let a deposit leave the importer without ever entering the shipping line's treasury.
- Virtual addresses give every container its own deposit address with no setup cost.
- Memos, batch transactions, fee sponsorship, passkeys and fast deterministic finality make it usable by clearing agents and line staff who have never touched crypto.

On other stablecoin chains each of these would be custom smart-contract code (an escrow contract, an allowance module, a per-address forwarder) that we would have to write, audit, and ask shipping lines to trust. On Tempo they are protocol behaviour.

## 3. The problem

Before a shipping line releases an import container, it demands a cash deposit to guarantee the empty box comes back on time and undamaged. The deposit covers detention charges (a daily fee once the free days run out) and damage. The line holds the cash, often for weeks or months, and refunds slowly, partially, or in a different currency. While the importer waits to make the deposit, the container waits at the port and storage fees run.

Two parties feel it:
- Importers and their clearing agents: cash tied up per container, slow and disputed refunds, release delayed while the deposit is arranged.
- Shipping lines and their local agents: need a guarantee for detention and damage, chase late returns, face regulators forcing faster refunds.

## 4. Evidence (each figure separate; do not add them up)

| Region | Evidence | Source type | Link |
|---|---|---|---|
| United States | Nine ocean carriers collected about $15.4B in detention and demurrage charges between April 2020 and March 2025 | Official (Federal Maritime Commission) | https://www.fmc.gov/detention-and-demurrage/ |
| United States | Average detention and demurrage of about $2,700 per box two weeks after discharge at Los Angeles/Long Beach (May 2022) | Industry (Container xChange via The Maritime Executive) | https://maritime-executive.com/article/report-american-ports-top-the-list-for-d-d-fees-worldwide |
| Global, top 20 ports | Average $666 per container, rising to $1,219 after two weeks (2021) | Industry (Container xChange via The Loadstar) | https://theloadstar.com/shipper-anger-and-confusion-as-opaque-global-dd-charges-double/ |
| Nigeria | About ₦200,000 deposit per 20ft and ₦400,000 per 40ft container; un-refunded deposits estimated near ₦20bn a year; ₦17bn collected in 2019 | News, citing clearing agents (Shipping Position, 2022) | https://shippingposition.com.ng/clearing-agents-knock-shipping-coys-as-un-refunded-container-deposit-near-n20billion/ |
| Kenya / East Africa | Deposits of $500 to $2,000 per TEU; about $1.5B a year tied up across East Africa | Opinion article (Nation Africa); ViaTrans gives the same $1.5B (vendor) | https://nation.africa/kenya/blogs-opinion/blogs/avoid-container-deposit-to-cut-cost-of-doing-business-4571774 |
| Kenya | Deposits of $1,000 to $4,000 by container size; refunds delayed after empties are returned; paid in US dollars but refunded in Kenyan shillings; making the cash deposit can take 2 to 4 extra weeks (USAID study quoted) | News (The Star, 2021) | https://www.the-star.co.ke/news/2021-07-16-clearing-agents-accuse-shippers-of-frustration |
| East Africa (regional body) | Iscos calls cash container deposits "a trade barrier" at Mombasa and Dar es Salaam | News (The EastAfrican, 2020) | https://theeastafrican.co.ke/tea/business-tech/shippers-call-for-scrapping-of-cash-deposits-for-containers-as-security-2370292 |
| Tanzania | A container guarantee product is used by six shipping lines and over 60% of registered clearing agents | Vendor, self-reported (ViaTrans via Trade Finance Global) | https://www.tradefinanceglobal.com/posts/viatrans-unloading-hidden-challenges-shipping-industry/ |
| Philippines | ₱10,000 to ₱30,000 deposit per container, held 60 to 90 days; Bureau of Customs draft rule would force refunds within 15 days of the empty-return receipt (Feb 2026) | News (PortCalls) | https://portcalls.com/stop-the-cash-leak-boc-eyes-15-day-clock-on-container-deposits |
| Pakistan | Karachi Customs Shipping Committee ordered shipping agents to "immediately refund all illegally recovered detention charges, ancillary charges, and container security deposits"; traders reported deposits over Rs 10 million withheld (Feb 2026) | News (Business Recorder) | https://www.brecorder.com/news/amp/40407829 |
| India | Hapag-Lloyd ended its import container security deposit requirement in India in September 2022, showing the practice existed | Carrier notice | https://www.hapag-lloyd.com/fr/company/about-us/newsletter/2022/09/india-import-container-security-deposit.html |
| Global scale | 849 million TEU handled at world ports in 2021 | Industry (Drewry/UNCTAD) | https://porteconomicsmanagement.org/pemp/contents/part1/maritime-shipping-and-international-trade/world-container-throughput/ |

Gaps to be honest about: no global total exists for deposits held or refund delays; the share of detention and demurrage caused by payment delays has never been measured.

## 5. Why existing fixes do not solve it

- Regulation (Philippines draft 15-day rule, Pakistan refund order, Nigeria Shippers' Council interventions) sets deadlines but cannot enforce them instantly.
- Container guarantee products (ViaTrans in Tanzania) move the risk to a third party for a fee, in one market.
- Insurance has not gained traction.
- Plain stablecoin transfers are fast, but the deposit still lands in the shipping line's treasury, so refunds are still at the line's discretion.

## 6. Users and roles

| Role | Who | Can do | Sees |
|---|---|---|---|
| Importer | The cargo owner, or a clearing agent or forwarder acting for them | Pay or authorize deposits, confirm details, dispute charges, see refunds | Their own containers, deposits, charges, refunds |
| Shipping line | The carrier's local agent at the port | Create release requests, choose deposit mode per importer, record empty returns, post charges, resolve disputes | Their own containers, deposits held, charges, exposure |
| Settlement contract | System actor | Splits held deposits between line and importer under fixed rules | Not a login |
| Platform | The product operator | Sponsors fees, runs the dispute fallback if both sides choose it | Aggregate status only |

## 7. Tempo features used, and exactly how

1. **Virtual addresses (TIP-1022).** Each container (or bill of lading) gets its own deposit address, derived from the shipping line's deposits account. The address is the reference: payments land already matched to the container, with no bank details to type wrong. No per-address setup cost.

2. **Receive policies (TIP-1028) with the protocol guard.** The shipping line's deposits account has a receive policy that does not accept incoming deposits into its balance. Transfers succeed, but funds sit in the protocol guard, recoverable only by the account's named recovery authority: the settlement contract. The deposit has left the importer (so the line is guaranteed) but never enters the line's treasury (so the line cannot sit on it). Wrong tokens or unknown senders are also held, not lost. Reference implementation of the same pattern: the "held" project on Tempo's Moderato testnet.

3. **Settlement contract as recovery authority.** Can send held funds to only two places: the shipping line (approved charges) or the original payer (refund). Rules in section 9.

4. **Access keys with periodic spending limits (deposit-free mode).** Instead of moving cash, the importer authorizes an access key on their own account, held by the shipping line:
   - token: the agreed USD stablecoin
   - limit: the daily detention rate for that container, period 1 day (resets daily)
   - recipient scope: only the shipping line's charges address
   - expiry: end of free time plus the maximum detention days allowed
   The line can pull at most one day's detention per day once free time ends, and nothing to anyone else. The importer's money stays in their account until a charge is actually owed. Key is revoked when the empty is returned.

5. **TIP-20 transfers with memos.** Every deposit, charge and refund carries the container number, bill of lading number and return receipt number in the memo, so both sides see the same record.

6. **Batch transactions.** An importer pays deposits for all containers on one bill of lading in one all-or-nothing transaction. A line settles many returned containers at once.

7. **Fee sponsorship.** The platform pays network fees, so importers, clearing agents and line staff never need gas.

8. **Passkeys.** Users sign in and approve with Face ID or a fingerprint; no seed phrases.

9. **Deterministic finality (about 0.5 seconds).** The line sees a final deposit or authorization instantly and issues the release order on the spot.

10. **Network.** Tempo Moderato testnet for the hackathon build.

## 8. Two deposit modes (the line chooses per importer)

| | Held deposit | Deposit-free |
|---|---|---|
| For | New or unknown importers | Importers with a clean track record on the platform |
| What moves | The deposit, into the protocol guard | Nothing until a charge is owed |
| Line's guarantee | Funds already held by the protocol | Daily-capped pull right on the importer's account |
| Line's risk | None up to the deposit | Importer revokes the key or empties the account |
| Importer's benefit | Refund within seconds of settlement | No cash locked at all |

A line can move an importer from held to deposit-free after a set number of clean returns, visible from on-chain history.

## 9. Settlement rules (fixed, shown to both sides up front)

- Free days and daily detention rate are set in the release request and shown to the importer before paying.
- Detention accrues per day after free time ends, up to the deposit amount.
- When the empty is returned, the line records the depot's return receipt (equipment interchange receipt number and date).
- After the return is recorded, the line has a fixed window (default 3 days; configurable, e.g. 15 days to match the Philippines draft rule) to post final charges, which cannot exceed the deposit or the accrued detention plus a stated damage amount.
- At the end of the window, the remainder refunds to the importer automatically; anyone can trigger it.
- Silent line: if the line never records a return, the importer can submit the return receipt themselves; the line has the same window to contest it, or the refund proceeds.
- Dispute: the importer can dispute posted charges once, inside the window. Disputed funds stay held; undisputed funds settle immediately. Disputes go to a resolver both sides agreed to at onboarding (the platform by default).

## 10. Pages, and the Tempo feature each one shows

| Page | Who | What happens | Tempo feature on screen |
|---|---|---|---|
| Landing | Everyone | The problem in one screen, links to the evidence, "Why Tempo" panel | None (explains them) |
| Sign in | Everyone | Passkey sign-in | Passkeys |
| Line: settings | Shipping line | Deposits account, charges address, default free days, rates and deposits | Receive policy and settlement contract set as recovery authority |
| Line: new release request | Shipping line | Enter bill of lading and containers, pick mode per importer | Virtual address generated per container |
| Importer: pay deposits | Importer | See terms, pay all containers in one tap | Batch transaction, fee sponsorship, memo, guard |
| Importer: authorize deposit-free | Importer | See daily cap, recipient, expiry; approve | Access key with 1-day period, recipient scope, expiry |
| Container detail | Both | Status, free-time countdown, live detention, full memo trail | Memos, finality timestamps |
| Line: record return and settle | Shipping line | Enter return receipt, post charges, settle | Settlement contract releasing from the guard; key revocation |
| Held transfers | Shipping line | Wrong-token or unknown-sender payments waiting for return | Receive policy guard |
| Disputes | Both | Open, view, resolve | Settlement contract (disputed funds stay held) |
| Importer dashboard | Importer | Cash held, cash freed, time from return to refund | Reads from memos and settlement events |
| Line dashboard | Shipping line | Deposits held, deposit-free exposure, refunds due and deadlines | Reads from guard and access-key state |

## 11. User flows

### 11.1 Onboarding
- Shipping line: signs up with a passkey, sets up its deposits account (receive policy and settlement contract configured by the app), its charges address, default free days, detention rates per container type, and default deposit amounts.
- Importer or clearing agent: signs up with a passkey, funds their account with the agreed stablecoin (on-ramp), and appears to lines as a known payer.

### 11.2 Release request (line)
1. Line enters the bill of lading and containers (number, size, type).
2. App fills free days, daily rate and deposit from the line's defaults.
3. Line picks the mode for this importer: held deposit or deposit-free.
4. App creates a virtual deposit address per container and sends the importer a request link.

### 11.3 Paying the deposit (importer, held mode)
1. Importer opens the request and sees containers, deposit per container, free days, daily rate and the refund rule.
2. Approves one batch payment with a passkey; fees sponsored.
3. Funds land in the protocol guard via each container's address; the memo records container and bill of lading.
4. Both sides see "Deposit held by protocol" within a second; the line issues the release order.

### 11.4 Authorizing deposit-free (importer, deposit-free mode)
1. Importer sees the daily cap, recipient (the line only) and expiry.
2. Approves the access key with a passkey; no money moves.
3. Line sees "Authorized: up to [daily rate] per day" and issues the release order.

### 11.5 During free time
- Both sides see a countdown to the end of free time per container.
- Importer gets reminders before detention starts.

### 11.6 Late return
- Held mode: accrued detention is shown live against the deposit.
- Deposit-free mode: after free time, the line's pull of one day's detention runs daily; each pull appears with its memo. A pull above the daily cap is refused by the chain.

### 11.7 Empty returned
1. Line records the return receipt number and date.
2. Final charges posted within the window, or none.
3. Settlement: charges to the line, remainder back to the importer, in one transaction, with memos. Deposit-free keys are revoked.
4. Importer sees "Refunded [amount]" and the time from return to refund.

### 11.8 Edge cases
- Wrong token or unknown sender: held by the guard and returned through the settlement contract; never lost.
- Overpayment: the excess refunds automatically at settlement.
- Partial payment: the release order stays blocked until each container is fully covered; the importer sees what is missing.
- Line silent after return: importer submits the receipt (rule in section 9).
- Disputed charges: only the disputed amount stays held.

### 11.9 Dashboards
- Importer: cash currently held, cash freed this month, average time from return to refund, containers in free time or detention.
- Line: deposits held, deposit-free exposure, containers past free time, detention collected, refunds due and the deadline for each (to show compliance with refund rules).

## 12. Scope

In: import container deposits, detention charges against them, refunds, disputes, dashboards.
Out: proving cargo condition or contents, customs duties, freight payments between shipper, forwarder and multiple carriers, privacy of amounts (Tempo Zones is not live in production; memos and amounts are public on testnet).

## 13. Assumptions to verify before building

- A receive policy on the line's deposits account can route all incoming deposits to the guard with the settlement contract as recovery authority (the "held" project on Moderato testnet shows the pattern).
- Access key call scopes can limit transfers to the line's charges address, with a 1-day recurring limit and an expiry (Tempo docs list per-token limits with a period, recipient scopes and expiry).
- How local-currency deposits (naira, shillings, pesos, rupees) map to the USD stablecoin, and who bears exchange-rate risk.

## 14. Backend and scheduling (Convex)

### 14.1 Shape
- SvelteKit is frontend only, multi-page with SvelteKit routing. It holds no secrets and signs nothing on the server.
- Convex is the whole backend: database, server functions, scheduling, and all server-side calls to Tempo.
- The browser talks to Convex for app data (with live updates) and to Tempo directly only when the user signs with their own passkey (paying deposits, authorizing an access key).

### 14.2 What lives in Convex
| Data | Purpose |
|---|---|
| Organizations | Shipping lines and importers, their Tempo addresses, deposits account, charges address |
| Rate cards | Per line: default free days, daily detention rate and deposit per container type |
| Release requests | Bill of lading, containers, mode (held or deposit-free), status |
| Containers | Number, size, virtual deposit address, free-time end, detention accrued, return receipt, settlement window end, state |
| Payments | Every on-chain event the app cares about (deposit, pull, settlement, refund, held transfer) with transaction hash, amount, memo, timestamp |
| Access key records | For deposit-free containers: key id, daily cap, recipient scope, expiry, revoked or not (the private key itself is a secret, see 14.5) |
| Disputes | Container, disputed amount, reason, resolver decision |
| Track record | Clean returns per importer per line, used to offer deposit-free mode |

Container states: requested, awaiting deposit, deposit held / authorized, released, in free time, in detention, returned, settling, settled, disputed.

### 14.3 Scheduled work (Convex scheduled functions and crons)
Tempo has no native scheduler, so Convex owns every time-based step.

| Trigger | Scheduled with | What it does |
|---|---|---|
| Container released | `runAt` free-time end | Moves the container to detention if not returned; in deposit-free mode, schedules the first daily pull |
| Each day in detention (deposit-free) | `runAt` +24h, re-scheduled after each run | Pulls one day's detention from the importer's account using the access key, with the container number in the memo |
| Each day in detention (held) | `runAt` +24h | Updates accrued detention against the deposit (no money moves until settlement) |
| Return recorded | `runAt` settlement window end | Settles: charges to the line, remainder to the importer, from the guard; revokes the deposit-free key |
| Access key near expiry | `runAt` expiry minus 1 day | Warns the line and importer |
| Daily cron | Convex cron, once a day | Backstop sweep: finds any container whose scheduled step was missed or failed and re-runs it |

### 14.4 Calling Tempo from Convex
- Convex actions call Tempo (Moderato testnet RPC) using viem, in files marked `"use node"` where Node APIs are needed. Actions time out after 10 minutes.
- Server-side actions: create virtual deposit addresses, configure the line's receive policy and settlement contract, sponsor fees, pull detention with the line's access key, submit settlements and refunds, read guard and access-key state.
- Mutations record intent first (for example "pull scheduled for container X, day 3"), then the action submits the transaction and a second mutation records the result.

### 14.5 Secrets
- Held as Convex environment variables or encrypted at rest: the fee sponsor key, the line's access keys for deposit-free containers, the operator key for settlement calls.
- Never sent to the browser. SvelteKit never sees them.

### 14.6 Failure handling
- Convex scheduled actions run at most once and are not retried automatically. Every scheduled action records success or failure; failures are retried by the next run or the daily backstop sweep.
- Every on-chain step is idempotent by design: a second detention pull in the same day is refused by the chain (1-day recurring limit), settlement can only happen once per container (the guard holds one deposit), and refunds check settlement state first.
- If Tempo RPC is unreachable, the container shows "pending on-chain" and the step is retried; the UI never shows "refunded" or "paid" until the transaction is confirmed.

### 14.7 Live updates
- Both sides' pages subscribe to Convex queries, so a deposit landing, a detention pull or a refund appears on the other party's screen immediately after the action records it.

### 14.8 Plan limits
- Convex's free plan includes crons and scheduled functions (exact free-tier limits are not published on the pricing page; demo scale is far below any limit).
- Vercel's free plan only allows once-a-day crons with up to 59 minutes of drift, and Cloudflare's free plan allows 10 ms of CPU per cron run; neither is needed with Convex scheduling.

## 15. References for Tempo features

- Virtual addresses: https://tempo.xyz/developers/docs/guide/payments/virtual-addresses
- Receive policies: https://tempo.xyz/blog/receive-policies/
- Access key permissions: https://v3.viem.sh/tempo/guides/access-keys/permissions
- Recurring limits and subscriptions: https://tempo.xyz/blog/subscriptions-on-tempo/
- Reference pattern for guard-held funds: https://github.com/emilbob/held
- Convex scheduled functions: https://docs.convex.dev/scheduling/scheduled-functions
- Convex cron jobs: https://docs.convex.dev/scheduling/cron-jobs
- Convex actions: https://docs.convex.dev/functions/actions
