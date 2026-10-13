# Live setup on Tempo Moderato

How to switch Portunus from the simulated chain (`TEMPO_MODE=sim`, the default) to the real Tempo Moderato testnet (`TEMPO_MODE=live`). Everything here runs on a **networked machine**. The build container this code was written in cannot reach Moderato, the fee sponsor, Convex cloud or tempo.xyz, so none of the live calls have been executed against the real chain. Read "What is verified and what is not" before demoing.

Code involved:

| File | Role |
|---|---|
| `contracts/PortunusSettlement.sol` | Recovery authority for the line's deposits account. Pays only the line's charges address or the original payer. |
| `web/src/lib/shared/tempo/settlementAbi.ts` | Generated ABI and bytecode (`pnpm compile:contract`). Committed. |
| `web/scripts/setup-tempo.ts` | One-time setup: keys, faucet, virtual-address master, contract deploy, receive policy. |
| `web/src/convex/tempoNode.ts` | `"use node"` Convex internal actions that talk to the chain with server keys. |
| `web/src/lib/tempo/passkey.ts`, `live.browser.ts` | Browser only: passkeys and the transactions the user signs. |
| `web/src/lib/shared/tempo/live/` | Pure helpers shared by both sides (memo codec, AES-GCM, receipt decoding, error classification). |

## 0. Prerequisites

- Node 22+, pnpm, a browser with passkey support (current Chrome, Safari or Edge) and a platform authenticator (Touch ID, Windows Hello, a phone, or a hardware key).
- Open the app at **`http://localhost:5173`**, never `http://127.0.0.1:5173`. WebAuthn rejects IP-address relying-party ids. `localhost` counts as a secure context, so HTTPS is not needed there.
- A passkey is bound to the page hostname. One created on `localhost` does not work on a deployed domain (and vice versa). Create separate test accounts per domain.
- Network access to `https://rpc.moderato.tempo.xyz` and (for the browser) `https://sponsor.moderato.tempo.xyz`.

## 1. Install and compile

```bash
cd web
pnpm install
pnpm compile:contract      # optional: settlementAbi.ts is committed; rerun only if the .sol changes
pnpm test:tempo            # offline tests (contract in a JS EVM, memos, AES-GCM, receipts, passkey checks)
```

`compile:contract` uses `solc@0.8.28` with `evmVersion: cancun` and the optimizer at 200 runs, the same settings the "held" project used successfully on Moderato. No Foundry needed.

## 2. Start Convex

```bash
npx convex dev                # log in, or: CONVEX_AGENT_MODE=anonymous npx convex dev
```

This creates the deployment and writes `web/.env.local` with `PUBLIC_CONVEX_URL` (and `PUBLIC_CONVEX_SITE_URL`). Leave it running; it pushes `src/convex/*`. Add `.convex/` to `.gitignore` (already done).

## 3. One-time chain setup

```bash
pnpm setup:tempo           # idempotent; about 15 minutes the first time
```

What it does, in order (each step is skipped if already done; state is saved after every step in the gitignored `web/.state/tempo.json`):

1. Generates testnet keys: sponsor (pays fees), operator (platform key that settles), line deposits account, line charges address, dispute resolver, plus the AES-GCM key for stored access keys and a random 16-bit virtual-address prefix.
2. Funds the sponsor and operator from the faucet (`tempo_fundAddress`).
3. Mines the deposits-account salt for the virtual-address master. This is a 32-bit proof of work: about 15 minutes on 4 cores on average, longer on bad luck. Run `pnpm setup:tempo --mine-only` first if you want to mine offline (for example on the plane).
4. Registers the deposits account as a virtual-address master (sponsored).
5. Deploys `PortunusSettlement(depositsAccount, charges, operator, resolver, AlphaUSD, maxHold)` from the operator. `maxHold` defaults to 30 days (`MAX_HOLD_SECONDS` to change). The operator pays this one fee itself.
6. Sets the receive policy on the deposits account: senders `reject-all`, tokens `allow-all`, recovery authority = the contract (sponsored). From now on every payment to the account or to any container address under it lands in the protocol guard and only the contract can move it.
7. Verifies policy, master id and the contract's immutables, then prints the Convex env commands and the public config.

Useful flags: `-- --print` (print env and config from saved state, no network), `REDEPLOY=1` (deploy a new contract and re-point the policy), `TEMPO_RPC_URL=...`.

Do not fund the deposits account from the faucet after step 6: with a reject-all policy the faucet tokens would be held by the guard. The script never does.

## 4. Configure Convex

Run the `npx convex env set ...` lines the script printed (from `web/`, against the dev deployment):

| Variable | Meaning |
|---|---|
| `TEMPO_MODE` | `live` switches the chain adapter. Set it last. `sim` (default) keeps everything simulated. |
| `TEMPO_RPC_URL` | Defaults to `https://rpc.moderato.tempo.xyz`. |
| `TEMPO_SPONSOR_KEY` | Pays network fees for every server transaction. Keep it funded with pathUSD. |
| `TEMPO_OPERATOR_KEY` | Platform key allowed to call `settle`, `settleMany`, `returnToSender`. |
| `TEMPO_RESOLVER_KEY` | Dispute resolver key (falls back to the operator key if unset). |
| `LINE_DEPOSITS_KEY` | The deposits account key. Only needed for setup and policy maintenance. |
| `ACCESS_KEY_ENC_KEY` | 32-byte AES-256-GCM key (hex) that encrypts the access-key private keys stored in the database. |
| `PORTUNUS_MASTER_ID` | The registered virtual-address master id (4 bytes). |
| `PORTUNUS_SETTLEMENT` | The deployed contract address. |
| `PORTUNUS_CHARGES` | The line's charges address. Must have no receive policy. |
| `PORTUNUS_DEPOSITS_ACCOUNT` | The line's deposits account (the virtual-address master). Copied onto the live line when it is provisioned; the indexer skips lines without it. |
| `VA_ENV_PREFIX` | 16-bit prefix mixed into every container's virtual address so databases sharing the master never collide. |
| `INDEXER_START_BLOCK` | Block the held-receipt indexer starts from (the contract deploy block). Without it the indexer scans from genesis. |

These are **testnet** keys. Never reuse them elsewhere and never put them in `.env.local`, the repo or the browser.

Then record the line's addresses in the live line's organization (`depositsAccount`, `chargesAddress`, `settlementContract`, `masterId`, `receivePolicy`) using the public config the script printed. How the live line's organization row is created is owned by the backend seed; if there is no live-line helper yet, edit that row in the Convex dashboard.

For a demo, add the one-click shipping line on the live chain (no passkey; line transactions are signed by the server keys anyway):

```bash
npx convex run seed:ensureLiveDemoLine   # creates Meridian Ocean Lines, provisioned on PORTUNUS_MASTER_ID and the contract
```

Check the wiring from the Convex dashboard by running the internal action `tempoNode:health` (expects `chainId: 42431`) and `tempoNode:publicConfig` (its `missing` list must be empty).

## 5. Browser configuration

The browser needs the RPC and sponsor URLs. Both default to the public ones, so nothing is required for a first run:

- RPC: `https://rpc.moderato.tempo.xyz`
- Sponsor: `https://sponsor.moderato.tempo.xyz` (public testnet sponsor, no key)

To override, call `configureLive({ rpcUrl, sponsorUrl })` from `src/lib/tempo/live.browser.ts` once on the client (root layout). This SvelteKit version (3) no longer types `$env/dynamic/public`; it is a deprecated alias of `$app/env/public`, which only exposes variables declared with `defineEnvVars` in `src/env.ts`. If you want `PUBLIC_TEMPO_RPC_URL` and `PUBLIC_TEMPO_SPONSOR_URL`, declare them there and pass them to `configureLive`.

To make the platform pay fees through your own relay instead of the public sponsor, serve the viem `Relay.feePayer` handler from a Convex `httpAction` (sketch in `docs/research/tempo-integration.md` section 4) and set the sponsor URL to `https://<deployment>.convex.site/tempo/relay`. That path is unverified in Convex's default runtime; the public sponsor is the safe default.

The pages call the browser signing code only when `TEMPO_MODE=live`: paying deposits (`payDepositsBatch`, then `deposits.recordLiveBatch`), authorizing access keys (`authorizeAccessKey`, then `accessKeys.authorize` with `liveTxHashes`), revoking (`revokeKey`, then `accessKeys.revoke` with `txHash`), and the faucet (automatic at importer sign-up, plus a button on the importer dashboard). The passkey signature on the transaction replaces the separate approval prompt. See `web/src/lib/app/README.md`.

## 6. Run it and smoke test

```bash
pnpm dev                   # http://localhost:5173
```

In order, on a networked machine (this is the smoke test nobody has been able to run yet):

1. `tempoNode:health` returns `ok: true`.
2. Sign up an importer with a passkey (real Face ID / fingerprint prompt). Fund the new address with the faucet button (`faucet(address)`).
3. Line creates a release request; each container gets a virtual deposit address under `PORTUNUS_MASTER_ID`.
4. Importer pays all deposits in one batch (one passkey prompt, sponsored). `tempoNode:confirmDeposits` must return one guard receipt per container; the deposit must show as held and the line's own balance must stay 0.
5. Line records the return, then settles. `tempoNode:settle` splits each held receipt: charges to the charges address, remainder back to the importer. Run once with one container (`settle`) and once with several (`settleMany`).
6. Deposit-free: importer authorizes an access key (two prompts). `tempoNode:pullDetention` once succeeds; a second pull the same day must come back as `{ error: 'SpendingLimitExceeded', remainingUnits, periodEnd }`.
7. Importer revokes the key (one prompt). `tempoNode:getAccessKeyState` must then report `isRevoked: true`.
8. Send a BetaUSD transfer to a container address and return it with `returnHeldTransfer`.

Switch back to simulation at any time with `npx convex env set TEMPO_MODE sim`. Rows are tagged with their mode and the two ledgers are never mixed, but do not flip the mode in the middle of a flow.

## 7. What is verified and what is not

**Verified offline in this repository** (`pnpm test:tempo`, `npx convex codegen --system-udfs --typecheck enable`, `pnpm check`):

- Every viem and `viem/tempo` symbol used by the live code typechecks against viem 2.57.4 (the installed sources).
- `PortunusSettlement.sol` compiles with solc 0.8.28 (cancun) and its behaviour is covered by tests executed in a JavaScript EVM against Solidity stand-ins for the guard, the address registry and a TIP-20 token: settle, settleMany (atomic), disputes and escrow, one-time settlement, access control, receipt length / authority / recipient / token checks, zero-amount legs skipped, `returnToSender`, `refundAfterDeadline`, constructor checks.
- Memo encoding, AES-GCM round trip, guard receipt decoding (from synthetic `TransferBlocked` logs built with viem's own encoders), virtual address derivation, passkey assertion verification (against a software authenticator), key authorization signing with a daily limit and recipient scope, SpendingLimitExceeded detection on error text and selector, the setup script's state and env output.
- `pnpm setup:tempo` loads, typechecks, and fails at the first network call with a clear message.

**Not verified (nothing was executed against Moderato).** These carry over from the research brief (section 12) and are joined by gaps specific to the contract and browser code:

1. No live call has ever run. Run the smoke test above before trusting any of it.
2. The contract was only executed against stand-ins. The real guard's reroute-claim rules (receiver must be an authorized sender, destination must accept the receiver) and the real TIP-20 `transferWithMemo` behaviour for the contract as a payer have not been exercised. The "held" project proved the claim-to-self-then-transfer pattern on Moderato; this contract copies it.
3. Whether `https://sponsor.moderato.tempo.xyz` is up, and which fee token it charges. Whether our own Convex `httpAction` relay works in the default runtime.
4. `deployContract` is paid by the operator, not the sponsor (sponsored deploy is untried). Faucet amounts are undocumented; the setup script funds the sponsor and operator when their pathUSD balance is below 100 and prints the resulting balance.
5. Zero-amount `transferWithMemo` is never sent (the contract skips zero legs), because its validity on the real chain is unknown.
6. The exact viem error shape for `SpendingLimitExceeded` at estimation time. Detection matches the error name and selector `0xe9a36a4b` anywhere in the cause chain, and falls back to comparing the remaining limit. If the real shape differs, a refused pull throws instead of returning the structured result; adjust `keychainErrorOf` in `shared/tempo/live/errors.ts`.
7. Safari: `sendTransactionSync` does a network round trip before the passkey prompt, which Safari may refuse as lacking user activation. If `payDepositsBatch` fails on Safari with `NotAllowedError`, prepare the transaction before the click (`client.prepareTransactionRequest`) and sign inside the click (brief section 3). Chrome tolerates the default flow.
8. Access keys: only the importer's root passkey can revoke; the line cannot. A deposit-free container therefore ends with "revocation pending importer approval" until the importer taps Revoke, or the key expires. The one-prompt authorization and pre-signed revoke variants in the brief are not implemented.
9. Period windows are anchored to the authorization time, not calendar days, so a daily pull scheduled slightly less than 24 hours after the previous one can be refused near the edge. Schedule pulls at least 24 hours apart.
10. The public RPC rate-limits in bursts. Clients retry five times; very busy flows may still see `Request exceeds defined limit`.
11. Passkey sign-in verification is demo grade unless the backend calls `verifyPasskeyAssertion` (`shared/tempo/live/passkey.ts`) with the stored public key.
12. Local-currency mapping and FX risk are product questions, not solved here.

If something fails in the smoke test, the live code is the most likely suspect, not the sim. The simulated mode is the reference behaviour the UI was built against.
