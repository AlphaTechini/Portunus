# Portunus

Container deposits and detention charges, guaranteed by the Tempo protocol. Shipping lines get a guarantee; importers stop locking cash for months. Deposits sit in the protocol guard (or never move at all, with an access key) and are refunded the moment the empty container is back.

Product spec: [`details.md`](details.md). Demo script: [`demo-video.md`](demo-video.md).

## Run it (offline, no accounts needed)

```bash
cd web
npm install
npm run dev -- --host localhost
```

Open **http://localhost:5173** (use `localhost`, not `127.0.0.1`, so passkeys work).

With no `PUBLIC_CONVEX_URL` set, the real Convex backend functions run **inside the browser** on seeded demo data, against a simulated Tempo chain. Everything works with no network. Sign in with a passkey, or pick a demo persona:

| Persona | Role | Use it to show |
|---|---|---|
| Adaeze Okafor, Meridian Ocean Lines | Shipping line | Release requests, virtual addresses, returns and settlement, held transfers |
| Tunde Bakare, Harbourview Foods | Importer (held deposit) | Paying deposits in one batch |
| Wanjiru Mwangi, Savanna Agro Traders | Importer (deposit-free) | Access key authorization, daily pulls |
| Resolution Desk | Platform resolver | Disputes |

The **Line / Importer** switch in the top bar flips between sides. The **Demo** panel (bottom right) moves the product clock forward, sends a stranger transfer, and resets data. Open two tabs to watch one side update live when the other acts.

## Repository

```
details.md, demo-video.md   product spec and demo plan
contracts/                  PortunusSettlement.sol (recovery authority for guard-held deposits)
docs/
  ARCHITECTURE.md           system contract: modes, data model, API, ownership
  API.md                    backend function reference
  LIVE-SETUP.md             switching to the real Tempo Moderato testnet
  research/                 Tempo integration brief (virtual addresses, receive policies, access keys, passkeys)
  design/DESIGN.md          design system spec and screenshots
web/                        SvelteKit 3 + Svelte 5 app
  src/convex/               Convex backend: schema, rules, scheduling, sim chain, live Tempo actions (tempoNode.ts)
  src/lib/ui/               design system components
  src/lib/app/              app-level composites (approval sheet, chain results, demo controls)
  src/lib/backend/          backend facade: Convex cloud or the in-browser runtime
  src/lib/tempo/            passkeys and browser-signed Tempo transactions
  src/lib/shared/           pure domain rules, memos, sim chain, live helpers
  src/routes/               pages
  e2e/                      Playwright tests (incl. the demo-video walkthrough)
  tests/                    backend tests (convex-test)
```

## Modes

| | Default | Switch |
|---|---|---|
| Backend | In-browser runtime (local) | Set `PUBLIC_CONVEX_URL` and run `npx convex dev` |
| Chain | Simulated (`sim`), clearly labelled in the UI | `TEMPO_MODE=live` in Convex env, after `npm run setup:tempo` (see [`docs/LIVE-SETUP.md`](docs/LIVE-SETUP.md)) |

The simulated chain follows the same rules as the live one: deposits to a line's virtual addresses land in the guard instead of its balance, a second same-day pull over the access key's daily limit is refused, and each guard receipt can be settled only once, paying only the line's charges address or the original payer.

## Checks

```bash
cd web
npm run check            # svelte-check + TypeScript
npm test                 # backend logic (vitest + convex-test)
npm run test:runtime     # in-browser Convex runtime
npm run test:tempo       # settlement contract in a JS EVM, memos, receipts, passkeys
npm run test:e2e         # Playwright end to end, including the demo-video script
npm run build
```

## Tempo features used

Virtual addresses (TIP-1022) give every container its own deposit address. Receive policies (TIP-1028) hold deposits in the protocol guard, with the settlement contract as recovery authority. Access keys with a 1-day recurring limit, a recipient scope and an expiry make deposit-free mode possible. TIP-20 memos, batch transactions, fee sponsorship, passkeys and fast finality round it out. On Tempo these are protocol behaviour; elsewhere they would be custom contract code.
