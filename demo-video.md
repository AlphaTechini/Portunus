# Portunus: demo video plan

Crypto World's Fair asks for two videos: a 2 to 3 minute presentation video and a demo video of up to 3 minutes. This file covers both. Times are targets.

Rules for both videos:
- Every number spoken is shown on screen with its source page open in the browser (links in section 3).
- Every Tempo feature is named on the page where the viewer sees it working.
- Say "on Tempo this is part of the protocol; elsewhere it would be custom contract code". Do not claim it is impossible elsewhere.

## 1. Demo video (up to 3:00)

### Chapter 1: Why we built this on Tempo (0:00 to 0:30)

Screen: Portunus landing page, "Why Tempo" panel.

Script:
"Portunus is built on Tempo because the guarantees it needs are part of the Tempo protocol. Access keys let a shipping line hold a capped, daily, expiring right over an importer's account. Receive policies hold a deposit in the protocol guard so it never lands in the line's treasury. Virtual addresses give every container its own deposit address. On other chains each of these would be a custom contract someone has to write, audit and trust."

On screen: four feature cards (Access keys, Receive policies + guard, Virtual addresses, Memos / batch / fee sponsorship / passkeys).

### Chapter 2: The problem, with the evidence open (0:30 to 1:05)

Screen: switch browser tabs to each source page, highlight the figure, 4 to 6 seconds each.

Script and pages, in order:
1. "Before a shipping line releases an import container, it takes a cash deposit, then holds it for weeks or months."
2. FMC page: "In the US alone, nine carriers collected about $15.4 billion in detention and demurrage between April 2020 and March 2025."
3. PortCalls (Philippines): "In the Philippines, deposits of 10,000 to 30,000 pesos per box are held 60 to 90 days. Customs now wants refunds within 15 days."
4. Business Recorder (Pakistan): "In Pakistan, customs ordered shipping agents to immediately refund withheld container deposits."
5. Nation Africa (Kenya): "Across East Africa, about $1.5 billion a year is tied up in deposits."
6. Shipping Position (Nigeria): "In Nigeria, un-refunded deposits are estimated near 20 billion naira a year."

### Chapter 3: The product, page by page (1:05 to 2:30)

Each step names the Tempo feature on screen with a small label.

1. Line: new release request (1:05 to 1:20)
   - Line enters a bill of lading with 3 containers and picks "Held deposit" for this importer.
   - Label: "Virtual address per container (TIP-1022)". Show the 3 generated addresses.

2. Importer: pay deposits (1:20 to 1:40)
   - Importer signs in with a passkey, sees terms, pays all 3 deposits in one tap.
   - Labels: "Passkey", "Batch transaction", "Fee sponsored, no gas", "Memo: container and B/L number".
   - Line's screen flips to "Deposit held by protocol" in under a second; release order issued.
   - Label: "Receive policy: funds in the protocol guard, not the line's balance (TIP-1028)".

3. Importer: deposit-free (1:40 to 1:55)
   - A trusted importer gets a container released with no money moving.
   - Label: "Access key: up to one day's detention per day, payable only to the line, expires at [date]".

4. Container detail: late return (1:55 to 2:10)
   - Free time ends. The line pulls one day's detention. It tries a second pull the same day and the chain refuses it.
   - Label: "Recurring limit enforced by the protocol, not by our app".

5. Line: record return and settle (2:10 to 2:25)
   - Line enters the return receipt number. Settlement: charges to the line, remainder back to the importer, in one transaction.
   - Labels: "Settlement contract = recovery authority", "Refund in seconds", "Access key revoked".

6. Held transfers (2:25 to 2:30)
   - A stranger sends the wrong token to a deposit address. It appears under Held transfers and is returned.
   - Label: "Held, not lost".

### Chapter 4: Close (2:30 to 3:00)

Screen: importer dashboard (cash freed, time from return to refund), then the "Why Tempo" panel again.

Script:
"The line was guaranteed every time. The importer never waited for a refund. And every rule you saw, the daily cap, the payee limit, the deposit held outside the line's treasury, the per-container address, is enforced by Tempo itself. On another stablecoin chain we would be asking shipping lines to trust our contracts. On Tempo they are trusting the protocol."

## 2. Presentation video (2:00 to 3:00)

1. Hook (0:00 to 0:15): "Your container is ready to leave the port. Before it moves, the shipping line wants your cash, and you won't see it again for months."
2. Why Tempo (0:15 to 0:40): same four features as Chapter 1, as one slide.
3. Evidence (0:40 to 1:20): one slide per region with the source page screenshot and link: United States, Philippines, Pakistan, East Africa, Nigeria. Say plainly that no global total exists.
4. What exists today and why it falls short (1:20 to 1:40): regulation deadlines, ViaTrans guarantee in Tanzania, insurance, plain stablecoins.
5. How Portunus works (1:40 to 2:15): two modes (held deposit, deposit-free), settlement rules, one diagram.
6. Go-to-market (2:15 to 2:40): start with shipping line agents and clearing agents in corridors where agents already accept USDT; regulator refund deadlines (Philippines 15 days) as the reason lines adopt.
7. Close (2:40 to 3:00): the Chapter 4 line.

## 3. Evidence pages to have open in tabs

| Tab | Region | Figure to highlight | Link |
|---|---|---|---|
| 1 | United States | $15.4B detention and demurrage, Apr 2020 to Mar 2025 | https://www.fmc.gov/detention-and-demurrage/ |
| 2 | United States | About $2,700 per box at LA/Long Beach (May 2022) | https://maritime-executive.com/article/report-american-ports-top-the-list-for-d-d-fees-worldwide |
| 3 | Philippines | ₱10,000 to ₱30,000 per box, held 60 to 90 days; 15-day draft rule | https://portcalls.com/stop-the-cash-leak-boc-eyes-15-day-clock-on-container-deposits |
| 4 | Pakistan | Customs order to refund container security deposits (Feb 2026) | https://www.brecorder.com/news/amp/40407829 |
| 5 | Kenya / East Africa | $500 to $2,000 per TEU; about $1.5B a year tied up | https://nation.africa/kenya/blogs-opinion/blogs/avoid-container-deposit-to-cut-cost-of-doing-business-4571774 |
| 6 | Kenya | Paid in USD, refunded in shillings; 2 to 4 weeks to make the deposit | https://www.the-star.co.ke/news/2021-07-16-clearing-agents-accuse-shippers-of-frustration |
| 7 | Nigeria | ₦200,000 / ₦400,000 per box; about ₦20bn a year un-refunded | https://shippingposition.com.ng/clearing-agents-knock-shipping-coys-as-un-refunded-container-deposit-near-n20billion/ |
| 8 | Tanzania | ViaTrans guarantee used by six lines (vendor figure) | https://www.tradefinanceglobal.com/posts/viatrans-unloading-hidden-challenges-shipping-industry/ |

## 4. Checklist before recording

- All tabs load (some news sites have paywalls or cookie banners; screenshot as backup).
- Testnet accounts funded: one shipping line, two importers (one held, one deposit-free), one stranger account for the wrong-token case.
- The second same-day detention pull is set up to fail on camera.
- Explorer link ready for one settlement transaction, to show the memo and the guard release on-chain.
