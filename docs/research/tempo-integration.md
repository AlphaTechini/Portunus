# Tempo integration brief (Portunus)

Research lead brief, 2026-10-11. Audience: the coding agents building `web/`. Follow it literally.
Every API below was checked against the installed `web/node_modules` (viem **2.57.4**, ox **0.14.54**, convex **1.46.0**, convex-svelte **0.14.0**). I also used the Tempo docs source (`github.com/tempoxyz/docs`, commit 2ee6e8d, 2026-10-10) and `github.com/emilbob/held` (commit ff73104, 2026-10-10). Items marked **UNVERIFIED** were not run against the live chain. Each one has a fallback.

---

## 0. TL;DR decisions

| Topic | Decision |
|---|---|
| SDK | Use **`viem/tempo`** and **`viem/chains`** only. Do not add `tempo.ts`, `accounts`, `tapimo`, `wagmi` or a direct `ox` dependency. Everything needed is re-exported by `viem/tempo`. |
| Chain | `tempoModerato` from `viem/chains` (id **42431**). |
| Tokens | Deposits and charges in **AlphaUSD** `0x20c0…0001`. Fees in **pathUSD** `0x20c0…0000`. All tokens have 6 decimals. Wrong-token demo uses **BetaUSD** `0x20c0…0002`. |
| Fees | All user transactions are sponsored (`feePayer`). Server transactions use a local sponsor key (`TEMPO_SPONSOR_KEY`). The browser uses `withRelay` to a sponsor URL (public `https://sponsor.moderato.tempo.xyz`, or our own Convex relay). |
| Line deposits account | A **server secp256k1 key** per line. It is a virtual-address master and has a receive policy of `reject-all` senders with the recovery authority set to the **PortunusSettlement** contract. It is provisioned once by a Node setup script, not from the UI. |
| Deposit-free | The importer's passkey authorizes a fresh **server-held secp256k1 access key** for each container. The key has a 1-day periodic limit on AlphaUSD, is scoped to `transferWithMemo` paying only the charges address, and has an expiry. |
| Revocation | **Only the importer's root key (passkey) can revoke.** The line can never revoke on its own (see §8). |
| Connectivity | **This container cannot reach Moderato, the sponsor, tempo.xyz, the Convex cloud or the Convex local-backend download** (all denied by the egress proxy). Build the `sim` adapter first. The `live` adapter can only be typechecked here. |
| Convex | It cannot run here. Offline codegen works (see §10). Run `npx convex dev` on a networked machine. |

---

## 1. Moderato testnet

| Property | Value | Source |
|---|---|---|
| Chain ID | `42431` (`0xa5bf`) | `viem/chains` `tempoModerato`, docs |
| HTTP RPC | `https://rpc.moderato.tempo.xyz` | same |
| WS RPC | `wss://rpc.moderato.tempo.xyz` | same |
| Explorer | `https://explore.testnet.tempo.xyz` (`/tx/<hash>`, `/address/<addr>`) | same, docs links |
| Native currency | none (shown as `USD`, 6 decimals). Fees are paid in TIP-20 stablecoins. | |
| Block time | about 0.5–0.6 s (held measured ~0.6 s/block). viem `chainConfig.blockTime = 1000`. | |
| Current hardfork | **T12** active on testnet since 2026-10-08 (T6 receive policies since 2026-06-18, T3 virtual addresses and periodic limits since 2026-04-21). viem's `tempoModerato.hardfork` says `'t5'`, which is stale. That only affects a pre-T3 branch in `getRemainingLimit`, so it is harmless. | docs `protocol/upgrades/*.mdx` |

### viem exports (verified in `web/node_modules/viem/package.json`)

- `viem/chains` exports `tempoModerato`, aliased `tempoTestnet`, `tempo` (mainnet 4217), `tempoDevnet` and `tempoLocalnet`.
- `viem/tempo` exports `Account, Actions, Abis, Addresses, Relay, Transaction, WebAuthnP256, P256, VirtualAddress, VirtualMaster, ReceivePolicyReceipt, Period, Expiry, ExecutionError, createClient, http, withRelay, tempoActions, KeyAuthorizationManager, TokenIds`, plus others.
- `viem/tempo/actions` and `viem/tempo/chains` also exist.
- `tempo.ts@0.14.2` exists on npm but is **not needed**.

### Tokens on Moderato (all 6 decimals)

| Symbol | Address |
|---|---|
| pathUSD | `0x20c0000000000000000000000000000000000000` |
| AlphaUSD | `0x20c0000000000000000000000000000000000001` |
| BetaUSD | `0x20c0000000000000000000000000000000000002` |
| ThetaUSD | `0x20c0000000000000000000000000000000000003` |
| OUSD (faucet also funds) | `0x20c0000000000000000000006a37da5c996874be` |

### System precompile addresses (`Addresses` from `viem/tempo`)

| Name | Address |
|---|---|
| `accountKeychain` | `0xaAAAaaAA00000000000000000000000000000000` |
| `addressRegistry` (TIP-1022) | `0xfdc0000000000000000000000000000000000000` |
| `receivePolicyGuard` | `0xB10C000000000000000000000000000000000000` |
| `tip403Registry` | `0x403c000000000000000000000000000000000000` |
| `feeManager` | `0xfeec000000000000000000000000000000000000` |

### Faucet

- RPC method `tempo_fundAddress(address)` returns `Hash[]`. One transaction is sent per token: pathUSD, AlphaUSD, BetaUSD, ThetaUSD and OUSD. Amounts are not documented ("allocations can change"), so read the balances afterwards.
- viem wraps it: `await Actions.faucet.fundSync(client, { account: '0x…' })` returns the receipts. `Actions.faucet.fund` returns the hashes only.
- HTTP alternative: `POST https://tempo.xyz/developers/api/faucet {"address":"0x…"}`. It is CORS-restricted to tempo.xyz, so call it server-side only. Prefer the RPC method.
- Fund an address **before** giving it a `reject-all` receive policy, otherwise the faucet tokens are held by the guard.

### Reachability test from this container (2026-10-11 06:18 UTC)

```text
curl -X POST https://rpc.moderato.tempo.xyz  {"method":"eth_chainId"}     -> curl: (56) CONNECT tunnel failed, response 403
curl -X POST https://rpc.moderato.tempo.xyz  {"method":"eth_blockNumber"} -> curl: (56) CONNECT tunnel failed, response 403
```

The proxy status reports `connect_rejected … rpc.moderato.tempo.xyz:443` (organization egress policy). The following are also blocked: `sponsor.moderato.tempo.xyz`, `tempo.xyz`, `docs.tempo.xyz`, `v3.viem.sh`, `version.convex.dev`, `api.convex.dev`, `foundry.paradigm.xyz` and GitHub release downloads. These are reachable: `registry.npmjs.org`, git clone of public GitHub repos, `raw.githubusercontent.com`.

### Client factory (live, server or browser)

```ts
import { tempoModerato } from 'viem/chains'
import { createClient, http } from 'viem/tempo' // Tempo client = public + wallet + tempo actions
export const PATH_USD = '0x20c0000000000000000000000000000000000000' as const
export const ALPHA_USD = '0x20c0000000000000000000000000000000000001' as const
// Public RPC rate-limits in bursts ("Request exceeds defined limit" / "Request is being rate limited", per held)
const rpc = () => http(process.env.TEMPO_RPC_URL ?? 'https://rpc.moderato.tempo.xyz', { retryCount: 5, retryDelay: 300 })
const client = createClient({ chain: tempoModerato, feeToken: PATH_USD, transport: rpc(), account /* optional */ })
// Namespaced actions: client.token.transferSync, client.accessKey.authorizeSync, client.receivePolicy.get,
// client.virtualAddress.registerMasterSync, client.faucet.fundSync, client.sendTransactionSync, ...
```

---

## 2. TIP-20 transfers with memo

- **Action:** `client.token.transfer(Sync)({ token, to, amount, memo })`, or the free function `Actions.token.transfer(Sync)(client, …)`. When `memo` is set, viem calls **`transferWithMemo(address to, uint256 amount, bytes32 memo)`** (selector `0x95777d59`). The memo is left-padded by `Hex.padLeft(memo, 32)`, so always pass exactly 32 bytes yourself.
- **Call builder, for batches:** `Actions.token.transfer.call({ token, to, amount, memo })` returns `{ address, abi, functionName: 'transferWithMemo', args }`. It needs no client when `amount` is a `bigint`. `amount` accepts `bigint` base units or `{ formatted: '12.5', decimals: 6 }`.
- **Event:** `TransferWithMemo(address indexed from, address indexed to, uint256 amount, bytes32 indexed memo)`, topic0 `0x57bc7354aa85aed339e000bccffabbc529466af35f0772c8f8ee1145927de7f0`. `Transfer(from,to,amount)` is also emitted. ABI: `Abis.tip20`.
- **Memo format:** `bytes32`. The docs recommend UTF-8, **right**-padded with `toHex(str, { size: 32 })` (it throws if longer than 32 bytes). Decode with `hexToString(memo, { size: 32 })`, which strips the padding (verified).
- **32 bytes cannot hold container + B/L + receipt.** Use the compact grammar below. Keep the full record in Convex (`payments` row keyed by `txHash` + `logIndex`), joined by container number.

| Kind | Memo string (≤32 bytes) | Example |
|---|---|---|
| Deposit | `PD <container11> <BL, last 17 chars>` | `PD MSCU1234567 MEDU12345678` |
| Detention pull (day n) | `PC <container11> D<nn> <BL tail ≤12>` | `PC MSCU1234567 D03 MEDU1234` |
| Settlement charge | `PS <container11> <EIR, last 17>` | `PS MSCU1234567 EIR-778812` |
| Refund | `PR <container11> <EIR, last 17>` | `PR MSCU1234567 EIR-778812` |
| Held-transfer return | `PX <first 16 hex of receipt id>` | `PX 3f9a…` |

```ts
import { toHex, hexToString } from 'viem'
export function encodeMemo(s: string): `0x${string}` {
  const b = new TextEncoder().encode(s)
  if (b.length > 32) throw new Error(`memo > 32 bytes: ${s}`)
  return toHex(s, { size: 32 })
}
export const decodeMemo = (m: `0x${string}`) => hexToString(m, { size: 32 })
```

### Reading memos back

- **Normal transfer:** `client.getContractEvents({ address: token, abi: Abis.tip20, eventName: 'TransferWithMemo', args: { to, memo }, fromBlock })`. `memo` is indexed, so you can filter on it.
- **Transfer to a virtual address** emits `Transfer(sender→virtual)`, then `TransferWithMemo(sender, virtual, amount, memo)`, then `Transfer(virtual→master)`. Treat the three as **one** deposit.
- **Deposit held by the guard (our case):** the canonical record is the guard **receipt**. `ReceivePolicyReceipt.decode(receipt)` returns `{ version, token, recoveryAuthority, originator, recipient /* the virtual address */, blockedAt, blockedNonce, blockedReason, kind, memo }`. The memo survives into the receipt (held relies on this).
- The getLogs range limit on the public RPC is between 100k and 200k blocks (held). Query in chunks of 50k blocks or fewer.

---

## 3. Batch transactions (atomic, passkey, sponsored)

A Tempo transaction (type `0x76`) carries `calls: Call[]`, which execute **atomically**: one revert reverts all of them. One signature means **one passkey prompt** for the whole batch.

```ts
// Browser, importer signed in with a passkey (see §5). Live mode.
import { createClient, http, withRelay, Actions, ReceivePolicyReceipt } from 'viem/tempo'
import { tempoModerato } from 'viem/chains'
const client = createClient({
  account,                                    // Account.fromWebAuthnP256(...)
  chain: tempoModerato,
  feeToken: PATH_USD,
  transport: withRelay(http(RPC_URL), http(SPONSOR_URL)), // SPONSOR_URL: see §4
})
const calls = containers.map((c) =>
  Actions.token.transfer.call({ token: ALPHA_USD, to: c.virtualAddress, amount: c.depositBaseUnits, memo: encodeMemo(`PD ${c.number} ${blTail}`) }),
)
const receipt = await client.sendTransactionSync({ calls, feePayer: true })
// One TransferBlocked receipt per call, in log order:
const heldReceipts = ReceivePolicyReceipt.fromTransactionReceipt(receipt) // readonly Hex[]
```

Then post `receipt.transactionHash` to a Convex action. The action **re-fetches the receipt server-side** (`client.getTransactionReceipt`) and records the payments. Never trust browser-reported amounts.

Gotchas:
- With `feePayer` set and no `nonceKey`, viem uses an **expiring nonce** (`validBefore = now + 25 s`). Submit right after signing.
- **Safari user activation:** `sendTransactionSync` runs `eth_fillTransaction` (network) before the WebAuthn prompt, and Safari may then refuse the prompt. If you see `NotAllowedError` on Safari, call `client.prepareTransactionRequest({...})` before the click, then `account.signTransaction(prepared)` and `client.sendRawTransactionSync({ serializedTransaction })` inside the click. Chrome tolerates the default flow.
- The line settles many containers with the same pattern: server-side calls to `PortunusSettlement.settleMany`, or several `settle` calls in one `calls` batch.

---

## 4. Fee sponsorship

How it works (spec): the sender signs with type byte `0x76` and does not commit to `fee_token`. The fee payer (secp256k1 only) signs a separate payload with magic byte `0x78` that includes `fee_token` and the sender address. Fee accounting then uses the fee payer.

| Path | How | Verified |
|---|---|---|
| **Server-side tx** (Convex: pulls, settlement, setup) | Pass a local account: `feePayer: sponsorAccount`. viem co-signs in-process (`Transaction.serialize` path). | Offline: an access-key-signed tx with `feePayer: sponsor` serializes to `0x76…` with keychain signature and fee-payer signature. |
| **Browser tx via relay** | `transport: withRelay(http(RPC), http(SPONSOR_URL))` plus `feePayer: true`. The relay answers `eth_fillTransaction` / `eth_signRawTransaction`. | Docs. **UNVERIFIED live.** |
| **Public testnet sponsor** | `SPONSOR_URL = 'https://sponsor.moderato.tempo.xyz'` (no API key, testnet only). | Docs (`guide/payments/sponsor-user-fees.mdx`, `api/fee-payer.mdx`). |
| **Own sponsor (platform pays)** | A Convex `httpAction` serving `Relay.create({ client, plugins: [Relay.feePayer({ account: sponsor, feeToken: PATH_USD, name: 'Portunus', validate })] }).fetch(request)` with CORS headers added. | Offline: `relay.request({ method: 'eth_signRawTransaction', params:[raw] })` and `relay.fetch(new Request(...))` both returned a co-signed `0x76` tx. **UNVERIFIED** in the Convex V8 runtime. |
| Manual co-sign, if the relay misbehaves | Browser: `account.signTransaction({...prepared, feePayer: true})` gives a `0x78…` envelope. Convex: `const tx = Transaction.deserialize(raw); const full = await Transaction.serialize({ ...tx, feeToken: PATH_USD, feePayer: sponsor }, tx.signature); await client.sendRawTransactionSync({ serializedTransaction: full })`. | Offline: co-signed `0x76`, sender preserved. |

**Recommendation:** use `PUBLIC_TEMPO_SPONSOR_URL`, defaulting to `${PUBLIC_CONVEX_SITE_URL}/tempo/relay` (our own sponsor) and falling back to `https://sponsor.moderato.tempo.xyz`. Server flows always use `TEMPO_SPONSOR_KEY`. Fund the sponsor with pathUSD from the faucet.

Do **not** use `tapimo` (its docs pin viem 2.56.9).

Convex relay sketch (`src/convex/http.ts`, default runtime, because `httpAction` cannot be `"use node"`):

```ts
import { httpRouter } from 'convex/server'
import { httpAction } from './_generated/server'
import { Account, Relay, createClient, http } from 'viem/tempo'
import { tempoModerato } from 'viem/chains'
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type' }
const relay = () => Relay.create({
  client: createClient({ chain: tempoModerato, transport: http(process.env.TEMPO_RPC_URL) }),
  plugins: [Relay.feePayer({ account: Account.fromSecp256k1(process.env.TEMPO_SPONSOR_KEY as `0x${string}`), feeToken: '0x20c0000000000000000000000000000000000000', name: 'Portunus',
    validate: (req) => true /* TODO: only our known importer addresses / our targets */ })],
})
const http_ = httpRouter()
http_.route({ path: '/tempo/relay', method: 'OPTIONS', handler: httpAction(async () => new Response(null, { headers: cors })) })
http_.route({ path: '/tempo/relay', method: 'POST', handler: httpAction(async (_ctx, req) => {
  const res = await relay().fetch(req)
  const h = new Headers(res.headers); for (const [k, v] of Object.entries(cors)) h.set(k, v)
  return new Response(res.body, { status: res.status, headers: h })
}) })
export default http_
```

**Pull transactions must be sponsored.** The protocol counts account-paid fees against an access key's spending limit, and a key whose `limits` list only AlphaUSD may not spend pathUSD at all. An unsponsored pull would therefore fail or eat the daily cap.

---

## 5. Passkeys (WebAuthn P-256 root accounts)

- `import { Account, WebAuthnP256 } from 'viem/tempo'`
- **Create:**
  ```ts
  const cred = await WebAuthnP256.createCredential({ label: 'Portunus – Acme Clearing', userId: crypto.getRandomValues(new Uint8Array(32)) /* ≤64 bytes */, rpId?: string })
  // cred = { id: string, publicKey: Hex /* 64-byte x||y, no 0x04 prefix */, raw }
  const account = Account.fromWebAuthnP256({ id: cred.id, publicKey: cred.publicKey }) // root account; account.address
  ```
  The library forces `residentKey: 'required'` and `userVerification: 'required'`.
- **Address derivation:** `address = last20(keccak256(pubX ‖ pubY))` (spec "P256 and WebAuthn"). There is no on-chain deployment or registration. The account can receive funds and send `0x76` transactions immediately. Fund it with the faucet.
- **Store the public key.** It cannot be recovered from a credential later. Convex table `passkeys { credentialId, publicKey, address, orgId, role }`.
- **Sign in:**
  ```ts
  const c = await WebAuthnP256.getCredential({ hash: randomChallengeHex, getPublicKey: async (raw) => await convex.query(api.passkeys.publicKey, { credentialId: raw.id }) })
  const account = Account.fromWebAuthnP256({ id: c.id, publicKey: c.publicKey })
  ```
  This is demo-grade auth with no server signature check. If needed, verify with `WebAuthnP256.verify` from `ox` server-side.
- **Signing:** every transaction or key-authorization signature triggers a WebAuthn prompt (`navigator.credentials.get`, challenge = hash).
- **rpId and domain constraints:**
  - The default rpId is `window.location.hostname`.
  - Use **`http://localhost:5173`**. WebAuthn rejects IP-address RP IDs, so `127.0.0.1` will not work.
  - Localhost is a secure context, so HTTPS is not needed there.
  - Passkeys are bound to the rpId: a passkey made on localhost will not work on the deployed domain. Create test accounts per domain.
- **What the Svelte app must do:**
  - Call WebAuthn only in the browser (`import { browser } from '$app/environment'` or `onMount`), never during SSR.
  - Trigger it from a click handler.
  - Keep the `Account` object in a client-side store. It is not serializable; rebuild it from `{id, publicKey}`.
  - **Passkeys work offline**, so in `sim` mode still do the real WebAuthn prompt and sign the sim payload hash. The UX stays identical.

---

## 6. Virtual addresses (TIP-1022)

- **Layout:** `0x | masterId (4 bytes) | fdfdfdfdfdfdfdfdfdfd (10 bytes) | userTag (6 bytes)`.
- A transfer to a virtual address credits the master. Balances are **never** held at the virtual address (`balanceOf(virtual) == 0`).
- Receive policies and TIP-403 checks run against the **resolved master**.

**A one-time registration transaction is required** from the master account. It needs a 32-bit proof-of-work salt: `keccak256(master ‖ salt32)` must start with 4 zero bytes, and `masterId = hash[4:8]`.

```ts
import { VirtualMaster, VirtualAddress, Actions } from 'viem/tempo'
const r = await VirtualMaster.mineSaltAsync({ address: depositsAccount, start: BigInt(pass) << 32n }) // loop pass=0,1,... until r
// r = { salt, masterId, registrationHash }. Store salt + masterId.
await Actions.virtualAddress.registerMasterSync(depositsClient, { salt: r.salt, feePayer: sponsor }) // emits MasterRegistered(bytes4 indexed masterId, address indexed masterAddress)
await Actions.virtualAddress.getMasterAddress(publicClient, { masterId }) // == depositsAccount once registered
```

- **Mining cost, measured here:**
  - 4 cores: about 4.9 M hashes/s with `mineSaltAsync` (WASM workers). The expected 2³² tries take about 15 min on average and can be much longer.
  - Single-thread JS `mineSalt` runs at about 88 k/s, so it is unusable.
  - held reported 164 s on a Mac.
  - Mining is **offline**, so run it in the Node setup script, never in a Convex action (10-minute limit).
- **Errors:** `ProofOfWorkFailed()`, `MasterIdCollision(address)`, `InvalidMasterAddress()` (zero, virtual, or TIP-20 prefix `0x20c0000000000000000000…`), `VirtualAddressUnregistered()`.
- **Per-container address** (free, offline, no transaction):
  ```ts
  // userTag (6 bytes) = envPrefix (16 bits, random per Convex deployment) << 32 | containerSeq (32 bits)
  const userTag = `0x${((BigInt(envPrefix) << 32n) | BigInt(containerSeq)).toString(16).padStart(12, '0')}` as const
  const depositAddress = VirtualAddress.from({ masterId, userTag })   // verified: 0x82bfcada fdfd… 000000000412
  VirtualAddress.parse(addr) // { masterId, userTag }
  VirtualAddress.isVirtual(addr)
  ```
  held lesson: environments that share one master but restart numbering will collide unless you add a random prefix. Match deposits **by full address**.
- **Identifying which address was paid:** for held deposits, read `ReceivePolicyReceipt.decode(receipt).recipient` (the virtual address) and parse its `userTag`. Otherwise use the `to` of `Transfer`/`TransferWithMemo`. The `TransferBlocked.receiver` (indexed) is the **master**.
- `Actions.virtualAddress.resolve(client, { address })` returns the master, or `null` if unregistered.

---

## 7. Receive policies (TIP-1028) and the protocol guard

**Live on Moderato:**
- Since T6 (2026-06-18). held ran 29/29 + 12/12 live checks on Moderato on Sep 23–30, 2026.
- T6 is also active on mainnet.

**Set the policy** (from the policy owner, the line deposits account):

```ts
await Actions.receivePolicy.setSync(depositsClient, {
  senderPolicyId: 'reject-all',   // built-in policy 0: every sender is blocked -> everything goes to the guard
  tokenPolicyId: 'allow-all',     // built-in policy 1 (token filter). Wrong tokens are held anyway because senders are rejected
  claimer: settlementAddress,     // recoveryAuthority. 'sender' = address(0) = originator, 'self' = receiver, or an address
  feePayer: sponsor,
})
// raw: TIP403Registry.setReceivePolicy(uint64 senderPolicyId, uint64 tokenFilterId, address recoveryAuthority)
// emits ReceivePolicyUpdated(address indexed account, uint64 senderPolicyId, uint64 tokenFilterId, address recoveryAuthority)
const p = await Actions.receivePolicy.get(client, { account: depositsAccount })
// { hasReceivePolicy, senderPolicyId: 'reject-all', tokenPolicyId: 'allow-all', claimer, recoveryAuthority }
await Actions.receivePolicy.validate(client, { token, sender, receiver }) // { authorized, blockedReason: 'none'|'tokenFilter'|'receivePolicy' }
```

**Rules:**
- The recovery authority must not be the guard, a virtual address, a TIP-20 address or a system precompile.
- Changing the authority affects only **future** receipts.
- A virtual address must not call `setReceivePolicy`. Set it on the master.

**What happens on a deposit:**
1. The TIP-20 call **succeeds**.
2. The token's own TIP-403 check still runs first and reverts on failure.
3. Funds are credited to `ReceivePolicyGuard` (`0xB10C…`) under one receipt per blocked transfer.
4. Events: `Transfer(…→guard)` and then:

```solidity
event TransferBlocked(address indexed token, address indexed receiver, uint64 indexed blockedNonce, uint256 amount, uint8 receiptVersion, bytes receipt);
// topic0 0x361d86e46fd139dc3eac4148f16b53597f0f8ddd9aba772aae0034bda5531b1c
event ReceiptClaimed(address indexed token, address indexed receiver, uint64 indexed blockedNonce, uint64 blockedAt, uint8 receiptVersion, address originator, address recipient, address recoveryAuthority, address caller, address to, uint256 amount);
event ReceiptBurned(... BURN_BLOCKED_ROLE only, not used ...);
```

`receipt` is the ABI-encoded `ClaimReceiptV1`: a tuple of `uint8 version, address token, address recoveryAuthority, address originator, address recipient, uint64 blockedAt, uint64 blockedNonce, uint8 blockedReason, uint8 kind, bytes32 memo` (exactly 320 bytes). Receipts are **not enumerable** on-chain: index `TransferBlocked` (filter `receiver = depositsAccount`) or extract them from the transaction receipt.

**Guard ABI** (`Abis.receivePolicyGuard`):
- `balanceOf(bytes receipt) → uint256`
- `claim(address to, bytes receipt)`
- `burnBlockedReceipt(bytes receipt)`
- Errors: `InvalidReceipt`, `InvalidClaimAddress`, `UnauthorizedClaimer`, `AddressReserved`.
- viem helpers: `Actions.receivePolicy.getBlockedBalance({ receipt })`, `claim(Sync)({ to, receipt })`, `watchBlocked({ onBlocked })`.

**Claim semantics** (`protocol/tip403/receive-policies.mdx`):
- **Only the recovery authority** can claim. With a zero authority, only the originator can.
- **One claim consumes the whole receipt. Partial claims do not exist.**
- **Resume claim** (`to == receiver`): pays the master (line deposits account) without rechecking its receive policy. **We do not use it.**
- **Reroute claim** (any other `to`): resolves virtual `to`. It requires the receiver (policy subject) to be a TIP-403-authorized sender, `to` to be an authorized recipient, and `to`'s own receive policy to accept the receiver.
- "Back to original payer" is a reroute to `receipt.originator`.
- "Charges to the line" is a reroute to our contract, which then transfers onward (held v3 pattern), or directly to a charges address that has no receive policy.

### The held pattern (summary)

- One `HeldArbiter` per merchant, compiled with **`solc` npm 0.8.28, `evmVersion: 'cancun'`, optimizer 200** and deployed with viem `deployContract`.
- Live testnet deployment (data only): merchant `0xeDaCEd83…63ed`, masterId `0x82bfcada`, arbiter `0x853dec03…cb2c`.
- Merchant setup script (`scripts/setup-merchant.ts`), in order:
  1. Faucet-fund.
  2. `mineSaltAsync` (loop passes).
  3. `registerMasterSync({ salt })`.
  4. `deployContract`.
  5. `receivePolicy.setSync({ senderPolicyId: 'reject-all', tokenPolicyId: 'allow-all', claimer: arbiter })`.
- Contract rules:
  - `_load(receipt)` requires `receipt.length == 320` (v4 fix: extra trailing bytes created a second id), `r.recoveryAuthority == address(this)`, and `r.recipient == merchant || REGISTRY.resolveRecipient(r.recipient) == merchant`.
  - `id = keccak256(receipt)`.
  - `release` → `GUARD.claim(merchant, receipt)`, or claim to `address(this)` and split with `transfer`.
  - `refund` → `GUARD.claim(r.originator, receipt)`.
- Indexer: `getLogs` on `TransferBlocked(receiver=merchant)` plus the arbiter's own events, in 50k-block chunks.
- Calls to the arbiter pass an explicit `gas: 2_000_000n`.
- Verified on Moderato by held:
  - Plain EVM transfers (eip1559 / legacy) to a virtual address are held too, so MetaMask works.
  - A direct `guard.claim` by merchant, buyer or resolver reverts (`UnauthorizedClaimer`).
- Do **not** reuse held's public sandbox keys in `network.testnet.json`.

---

## 8. Access keys (periodic limits, recipient scope, expiry)

Precompile `AccountKeychain` `0xaAAA…`, ABI `Abis.accountKeychain`. Periodic limits and scopes have been live since T3. The canonical `authorizeKey` selector is `0x980a6025`; viem handles it.

### Who and what

| Item | Value |
|---|---|
| Account | Importer passkey account (root, `keyType 'webAuthn'`) |
| Who signs the authorization | Importer **root key** (passkey). Limited keys cannot authorize keys. |
| The key | A fresh **secp256k1** key generated in a Convex action, **one per container authorization**. A revoked keyId can never be re-authorized on that account, and the docs say not to share keys. The private key is stored encrypted in Convex. The browser only receives its **address**. |
| keyType | `'secp256k1'` (signatureType 0) |
| Limit | `[{ token: ALPHA_USD, limit: dailyRateBaseUnits, period: Period.days(1) /* 86400 */ }]` |
| Scope | `[{ address: ALPHA_USD, selector: 'transferWithMemo(address,uint256,bytes32)', recipients: [chargesAddress] }]`. Recipient lists are only valid for `transfer`, `approve` and `transferWithMemo`. |
| Expiry | `freeTimeEndSec + maxDetentionDays * 86400` (unix seconds; must be in the future, `0` is rejected) |

**Period semantics** (TIP-1011):
- At authorization, `periodEnd = authorize_time + period` and `remaining = limit`.
- When `now >= periodEnd`, `remaining` resets to `limit` and `periodEnd` advances by whole periods.
- Windows are anchored to the authorization time, **not calendar days**.

### Authorize: browser, importer passkey (two WebAuthn prompts: key-authorization digest + transaction)

```ts
import { Period } from 'viem/tempo'
const { receipt, ...ev } = await client.accessKey.authorizeSync({ // client = passkey client from §3
  accessKey: { address: lineKeyAddress, type: 'secp256k1' },        // resolveAccessKey accepts {address,type}
  expiry,                                                          // number (unix seconds)
  limits: [{ token: ALPHA_USD, limit: dailyRate, period: Period.days(1) }],
  scopes: [{ address: ALPHA_USD, selector: 'transferWithMemo(address,uint256,bytes32)', recipients: [chargesAddress] }],
  feePayer: true,                                                  // sponsored via withRelay
})
// ev = KeyAuthorized(address indexed account, address indexed publicKey, uint8 signatureType, uint64 expiry)
```

Verified offline: `root.signKeyAuthorization({ address, type: 'secp256k1' }, { chainId: 42431n, expiry, limits:[{token, limit, period: 86400}], scopes:[…] })` returns a signed authorization.

**One-prompt alternative (UNVERIFIED live):**
1. The browser calls `client.accessKey.signAuthorization({ accessKey, chainId: 42431, expiry, limits, scopes })`. This is a single passkey prompt and sends no transaction.
2. Send the signed authorization to Convex, serialized as JSON with bigint→string.
3. Attach it as `keyAuthorization` to the **first pull** (the spec says an access key may sign the transaction that authorizes it).

The downside: nothing is on-chain until the first pull, so "Authorized" would be off-chain only. Use the two-prompt flow for the demo.

### Pull: Convex `"use node"` action

```ts
const lineKey = Account.fromSecp256k1(decrypt(keyRow.encPrivKey), { access: importerAddress }) // tx.from = importer
const sponsor = Account.fromSecp256k1(process.env.TEMPO_SPONSOR_KEY as `0x${string}`)
const c = createClient({ account: lineKey, chain: tempoModerato, feeToken: PATH_USD, transport: rpc() })
const { receipt } = await c.token.transferSync({ token: ALPHA_USD, to: chargesAddress, amount: dailyRate, memo: encodeMemo(`PC ${container} D${day}`), feePayer: sponsor })
// emits AccessKeySpend(account, publicKey, token, amount, remainingLimit) + TransferWithMemo
const { remaining, periodEnd } = await c.accessKey.getRemainingLimit({ account: importerAddress, accessKey: lineKey.accessKeyAddress, token: ALPHA_USD })
const meta = await c.accessKey.getMetadata({ account: importerAddress, accessKey: lineKey.accessKeyAddress }) // { keyType, expiry, spendPolicy, isRevoked }
```

Verified offline: this signs to `0x76`, `from = importer`, signature type `keychain`, with a fee-payer signature.

### A second same-day pull

- It reverts with **`SpendingLimitExceeded()`**, selector **`0xe9a36a4b`**. Usually it surfaces at estimation (`eth_fillTransaction`) as a viem `ContractFunctionExecutionError` / `EstimateGasExecutionError`, so no transaction is mined.
- `ExecutionError.from(...)` from `viem/tempo` did **not** decode the bare selector in my test. Detect it robustly:

```ts
const isLimitExceeded = (e: unknown) => /SpendingLimitExceeded|0xe9a36a4b/i.test(
  [e, (e as any)?.cause, (e as any)?.cause?.cause].map((x) => `${x?.shortMessage ?? ''} ${x?.message ?? ''} ${x?.data ?? ''} ${x?.cause?.data ?? ''}`).join(' '))
```

Also pre-check `getRemainingLimit`. For the video, still **send** the second pull so the chain is what refuses it.

Other errors:

| Error | Selector |
|---|---|
| `CallNotAllowed()` (wrong recipient or selector) | `0x90800d35` |
| `KeyExpired()` | `0x403ac939` |
| `KeyAlreadyRevoked()` | `0x6e143480` |
| `UnauthorizedCaller()` | `0x5fc755d3` |

Call-scope mismatches may be rejected at validation, before execution.

### Revocation

- `revokeKey(keyId)` must be signed by the **root key or an admin key** of the importer: `client.accessKey.revokeSync({ accessKey: lineKeyAddress, feePayer: true })` from the importer's passkey client. It emits `KeyRevoked(account, publicKey)`.
- **The line or the platform cannot revoke.** Limited keys calling it revert `UnauthorizedCaller`.
- Do **not** use admin keys: they are unrestricted.
- Product consequence:
  - At settlement, show "Revocation pending importer approval" and offer the importer a one-tap **Revoke** button.
  - Expiry is the backstop.
  - Convex also stops using the key.
  - Mark `revoked` in the DB only after `getMetadata().isRevoked`.
- Optional, **UNVERIFIED**: at authorization time the importer also pre-signs a `revokeKey` transaction (`feePayer: true`, an explicit random `nonceKey` (bigint) with `nonce: 0` so it is **not** an expiring nonce, and a generous `maxFeePerGas`). Convex stores the raw transaction, then co-signs it as sponsor and broadcasts it at return (§4 manual co-sign). That makes "Access key revoked" automatic, at the cost of a third prompt. Test it live before relying on it.

---

## 9. Settlement contract (recovery authority)

The contract enforces destinations and caps on-chain: payouts go only to `charges` (the line) or `receipt.originator` (the payer), and never more than the receipt holds. The section 9 timing rules (free days, accrual, window) are computed in Convex. The contract enforces only "≤ deposit" and the post-deadline anyone-can-refund rule. Say this plainly in UI copy.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;   // compile: solc npm 0.8.28, evmVersion 'cancun' (proven on Moderato by held)

interface IReceivePolicyGuard { function claim(address to, bytes calldata receipt) external; function balanceOf(bytes calldata receipt) external view returns (uint256); }
interface IAddressRegistry { function resolveRecipient(address to) external view returns (address); }
interface ITIP20 { function transferWithMemo(address to, uint256 amount, bytes32 memo) external; }

interface IPortunusSettlement {
    struct Receipt { uint8 version; address token; address recoveryAuthority; address originator; address recipient;
                     uint64 blockedAt; uint64 blockedNonce; uint8 blockedReason; uint8 kind; bytes32 memo; } // ClaimReceiptV1
    enum Status { None, Settled, Disputed, Returned }

    event Settled(bytes32 indexed id, address indexed originator, address indexed depositAddress, uint256 charged, uint256 refunded, uint256 disputedHeld);
    event Returned(bytes32 indexed id, address indexed originator, address token, uint256 amount);       // wrong token / unknown sender
    event DisputeResolved(bytes32 indexed id, uint256 toLine, uint256 toPayer);

    // immutables
    function depositsAccount() external view returns (address); // the master with the receive policy
    function charges() external view returns (address);         // line's charges address: plain account, NO receive policy
    function operator() external view returns (address);        // Portunus platform key (Convex), may settle
    function resolver() external view returns (address);        // dispute resolver (platform by default)
    function token() external view returns (address);           // AlphaUSD
    function maxHold() external view returns (uint64);          // seconds after blockedAt after which anyone may refund untouched receipts

    function idOf(bytes calldata receipt) external pure returns (bytes32);   // keccak256(receipt)
    function statusOf(bytes32 id) external view returns (Status);

    /// operator or line only. Claims the full receipt to this contract, pays `charge` to charges and
    /// (amount - charge - disputed) to r.originator, keeps `disputed` in escrow. Requires: len==320,
    /// r.recoveryAuthority==this, resolveRecipient(r.recipient)==depositsAccount, r.token==token,
    /// status None, charge+disputed <= amount.
    function settle(bytes calldata receipt, uint256 charge, uint256 disputed, bytes32 chargeMemo, bytes32 refundMemo) external;
    function settleMany(bytes[] calldata receipts, uint256[] calldata chargesArr, uint256[] calldata disputedArr,
                        bytes32[] calldata chargeMemos, bytes32[] calldata refundMemos) external;
    /// operator or line: full receipt straight back to r.originator (GUARD.claim(r.originator, receipt)), any token.
    function returnToSender(bytes calldata receipt) external;
    /// resolver only, once: pays toLine to charges and the rest of the escrow to the originator.
    function resolveDispute(bytes calldata receipt, uint256 toLine, bytes32 memo) external;
    /// anyone, if status None and block.timestamp >= r.blockedAt + maxHold: full refund to originator.
    function refundAfterDeadline(bytes calldata receipt) external;
}
```

Implementation notes:
- Copy held's `_load` checks verbatim, including the length check.
- Claim to `address(this)`, then `ITIP20(r.token).transferWithMemo(...)`. Skip zero-amount legs; do not send `transferWithMemo` with amount 0.
- Set status **before** external calls.
- Mark each receipt id settled exactly once. That makes it idempotent (details.md 14.6).
- Never take a destination address as an argument.

**Compile and deploy** without Foundry (solc verified offline here: `npm i -D solc@0.8.28` compiled a guard-calling contract):

```ts
// scripts/compile.ts (Node): same as held/scripts/compile.ts
import solc from 'solc'
const out = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources: { 'PortunusSettlement.sol': { content: src } },
  settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } })))
// deploy (root secp256k1 operator account; access keys cannot create contracts)
const hash = await operatorClient.deployContract({ abi, bytecode: `0x${obj}`, args: [depositsAccount, charges, operator, resolver, ALPHA_USD, maxHold] })
const { contractAddress } = await operatorClient.waitForTransactionReceipt({ hash })
```

- Fund the operator with the faucet; it pays its own fee. Passing `feePayer: sponsor` to `deployContract` is **UNVERIFIED**.
- If gas estimation of contract calls fails, pass `gas: 2_000_000n` (held does this).
- T12 adds an EIP-2200 stipend check on native precompiles, so do not hardcode low gas.

**Foundry:** not installable here (`foundry.paradigm.xyz` and GitHub release downloads return 403). On a dev machine, `foundryup -n tempo` installs Tempo's fork (forge ≥1.8.3), which runs tests against the real precompiles (held: 33 tests). It is optional.

---

## 10. Convex

### Can a local backend run here? **No.**

- `CONVEX_AGENT_MODE=anonymous npx convex dev --once --configure new --dev-deployment local` failed with `✖ Cannot prompt for input in non-interactive terminals. (Device name:)`.
- `CONVEX_AGENT_MODE=anonymous npx convex init` (documented agent path: `export CONVEX_AGENT_MODE=anonymous && npx convex init && npx convex dev`) failed with `✖ Failed to fetch latest backend version`. `version.convex.dev` and the GitHub release binary are blocked.
- No backend started, nothing to stop. **No files were created in `web/`.** I ran the experiments in a scratch copy (`…/scratchpad/convex-test`), and no `~/.convex` state was written.
- On a networked machine, run `cd web && CONVEX_AGENT_MODE=anonymous npx convex dev`. Per CLI source this creates deployment `anonymous-agent` and state in `web/.convex/local/default/`. It writes `web/.env.local` with `CONVEX_DEPLOYMENT=…`, **`PUBLIC_CONVEX_URL`** (local default `http://127.0.0.1:3210`) and **`PUBLIC_CONVEX_SITE_URL`** (3211). The SvelteKit names come from `@sveltejs/kit` detection in `envvars.js`. Observed? **No** (inferred from source).
- Alternatively, log in normally (`npx convex dev`) for a cloud dev deployment.
- Add `.convex/` to `web/.gitignore`. `.env.*` is already ignored.

### Offline codegen works here (verified)

```bash
cd web && npx convex codegen --system-udfs --typecheck enable   # add --init once to write src/convex/tsconfig.json
```

This writes standard `_generated/{api,server,dataModel}.{d.ts,js}` from `convex.json` with no deployment and runs `tsc`. `--system-udfs` is a hidden flag that skips the deployment lookup. The output is identical to normal codegen (`api = anyApi`; `ApiFromModules<{…}>` types). Without the flag, codegen needs a deployment and fails here.

### Project config

`web/convex.json`:
```json
{ "functions": "src/convex/" }
```
Convex functions must not import SvelteKit aliases (`$lib`, `$env`). Share pure TS through relative imports (for example `src/lib/shared/*.ts`).

### convex-svelte 0.14 usage (verified exports)

Exports: `setupConvex, useQuery, useMutation, useAction, useConvexClient, getConvexClient, closeConvex, usePaginatedQuery, setupAuth, useAuth`.

```svelte
<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import { setupConvex } from 'convex-svelte'
  import { PUBLIC_CONVEX_URL } from '$env/static/public'   // build fails if unset -> keep a .env.example
  const client = setupConvex(PUBLIC_CONVEX_URL)            // once, root layout
  let { children } = $props()
</script>
{@render children()}
```
```svelte
<script lang="ts">
  import { useQuery, useMutation, useConvexClient } from 'convex-svelte'
  import { api } from '../../convex/_generated/api.js'
  const containers = useQuery(api.containers.list, () => (orgId ? { orgId } : 'skip'), { keepPreviousData: true })
  // containers.data | containers.isLoading | containers.error | containers.isStale
  const record = useMutation(api.containers.recordReturn)   // (args) => Promise
  const convex = useConvexClient()                           // component init only; getConvexClient() works anywhere
</script>
```
Do not wrap `useQuery` in `$derived`. Return `'skip'` from the args function instead.

### Runtime constraints

**`"use node"` files:**
- They can **only export actions** (`action`/`internalAction`), not queries or mutations.
- Call DB functions via `ctx.runQuery/ctx.runMutation(internal.x.y, args)`.
- Put all viem/Tempo calls in `src/convex/tempoNode.ts` (or similar) with `"use node";` as the first line.
- `httpAction` cannot be in a node file. The §4 relay runs in the default runtime (**UNVERIFIED** that viem runs there; fallback: public sponsor URL).
- Actions time out after 10 minutes. Scheduled actions run **at most once** and are not retried.

**Scheduler** (`ctx.scheduler`, available in mutations and actions):
```ts
await ctx.scheduler.runAt(timestampMs /* number | Date */, internal.detention.pull, { containerId, day })
await ctx.scheduler.runAfter(24 * 60 * 60 * 1000, internal.detention.pull, { containerId, day: day + 1 })
await ctx.scheduler.cancel(scheduledId)
```
Scheduling from a mutation is atomic with that mutation.

**Crons** (`src/convex/crons.ts`):
```ts
import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'
const crons = cronJobs()
crons.daily('backstop sweep', { hourUTC: 2, minuteUTC: 0 }, internal.sweep.run, {})
crons.interval('index guard receipts', { minutes: 1 }, internal.indexer.tick, {})
export default crons
```
Schedules: `interval({seconds|minutes|hours})`, `hourly`, `daily({hourUTC,minuteUTC?})`, `weekly`, `monthly`, `cron('* * * * *')`.

**Secrets:** use `npx convex env set TEMPO_SPONSOR_KEY 0x…` (not `.env.local`) and read them as `process.env.X`. Needed:
- `TEMPO_MODE`
- `TEMPO_RPC_URL`
- `TEMPO_SPONSOR_KEY`
- `TEMPO_OPERATOR_KEY`
- `LINE_DEPOSITS_KEY` (only for setup / policy reads)
- `ACCESS_KEY_ENC_KEY` (32-byte AES-GCM key for stored access keys)
- `PORTUNUS_MASTER_ID`
- `PORTUNUS_SETTLEMENT`
- `PORTUNUS_CHARGES`
- `VA_ENV_PREFIX`

---

## 11. Integration architecture: LIVE vs SIMULATED

### Feature matrix

| Feature | LIVE on Moderato today (how) | SIM (when no connectivity / not set up) |
|---|---|---|
| Faucet | `Actions.faucet.fundSync` (`tempo_fundAddress`) | Credit the sim ledger: 1,000,000 of each test token |
| Passkey accounts | Real WebAuthn plus `Account.fromWebAuthnP256`, real address | **Same real WebAuthn** (works offline). Sign the sim tx hash. |
| Virtual addresses | Pure `VirtualAddress.from` with the registered `masterId` (one-time setup script) | Same function, with a fixed sim masterId `0x5133d000` (fake, flagged unregistered) |
| Receive policy + guard | `receivePolicy.setSync(reject-all, allow-all, settlement)` once. Deposits go to the guard. Index `TransferBlocked`. | Sim ledger routes every inbound to the deposits account into `sim_receipts` with an encoded ClaimReceiptV1 (`ReceivePolicyReceipt.encode`) |
| Memos | `transferWithMemo` | Stored on sim transfer events |
| Batch | `sendTransactionSync({ calls, feePayer: true })` | All-or-nothing: validate every call first, then apply all |
| Fee sponsorship | Server: `feePayer: sponsorAccount`. Browser: `withRelay` + `feePayer: true`. | No-op. UI still shows "Fee sponsored". |
| Access keys | `accessKey.authorizeSync` (browser), access-key `transferSync` (Convex), `revokeSync` (browser) | Sim keychain table with identical semantics (period anchoring, scope, expiry, revoked-forever) |
| Settlement contract | Deployed `PortunusSettlement` via setup script; `settle` / `settleMany` / `returnToSender` from operator | Sim contract function with the same checks and events |
| Finality | ~0.5 s; `*Sync` actions return the receipt | `await sleep(500)` |

### Adapter interface

Location: `src/lib/shared/tempo/adapter.ts`, pure TS so both Convex and the browser can import it.

```ts
export type Hex = `0x${string}`; export type Address = Hex
export type Mode = 'live' | 'sim'
export interface TxResult { mode: Mode; txHash: Hex; blockNumber: bigint; timestamp: number /* ms */; explorerUrl: string | null }
export interface HeldReceipt { id: Hex /* keccak256(receipt) */; receipt: Hex; token: Address; amount: bigint; originator: Address;
  recipient: Address /* virtual */; blockedAt: number; memo: Hex; blockedReason: 'tokenFilter' | 'receivePolicy'; txHash: Hex; logIndex: number }
export class SpendingLimitExceededError extends Error { readonly code = 'SpendingLimitExceeded' as const; constructor(public remaining: bigint, public periodEnd: number) { super('Spending limit exceeded (refused by the chain)') } }
export interface Signer { address: Address; kind: 'passkey' | 'server' }   // live: viem Account; sim: passkey still signs a payload hash

export interface TempoAdapter {
  readonly mode: Mode
  health(): Promise<{ ok: boolean; chainId?: number; blockNumber?: bigint; error?: string }>
  fundFromFaucet(address: Address): Promise<TxResult[]>                                            // server
  createVirtualAddress(a: { masterId: Hex; envPrefix: number; containerSeq: number }): Address      // pure, sync, both modes
  payDepositsBatch(a: { payer: Signer; token: Address; items: { to: Address; amount: bigint; memo: Hex }[] })
    : Promise<TxResult & { held: HeldReceipt[] }>                                                    // browser (passkey), sponsored
  confirmDeposits(a: { txHash: Hex }): Promise<HeldReceipt[]>                                       // server re-reads the receipt
  createAccessKey(): Promise<{ keyAddress: Address; encPrivKey: string }>                          // server
  authorizeAccessKey(a: { owner: Signer; keyAddress: Address; token: Address; dailyLimit: bigint; periodSec: number;
    recipient: Address; expiry: number }): Promise<TxResult>                                         // browser (2 prompts live)
  getAccessKeyState(a: { account: Address; keyAddress: Address; token: Address })
    : Promise<{ remaining: bigint; periodEnd: number; expiry: number; isRevoked: boolean }>          // server/browser read
  pullDetention(a: { account: Address; encPrivKey: string; token: Address; to: Address; amount: bigint; memo: Hex })
    : Promise<TxResult>                                                                              // server; throws SpendingLimitExceededError
  revokeKey(a: { owner: Signer; keyAddress: Address }): Promise<TxResult>                           // browser (importer only)
  settle(a: { items: { receipt: Hex; charge: bigint; disputed: bigint; chargeMemo: Hex; refundMemo: Hex }[] }): Promise<TxResult> // server/operator
  returnHeldTransfer(a: { receipt: Hex }): Promise<TxResult>                                        // server/operator
  readGuardBalance(a: { receipt: Hex }): Promise<bigint>                                            // read
  listHeldReceipts(a: { depositsAccount: Address; fromBlock: bigint }): Promise<{ receipts: HeldReceipt[]; toBlock: bigint }> // server indexer
  getBalance(a: { account: Address; token: Address }): Promise<bigint>
}
```

### Live sketch

`src/convex/tempoNode.ts` (`"use node"`) for server methods; `src/lib/tempo/live.browser.ts` for passkey methods.

| Method | Live implementation |
|---|---|
| `payDepositsBatch` | §3 |
| `authorizeAccessKey`, `revokeKey` | §8, browser |
| `pullDetention` | §8: `Account.fromSecp256k1(decrypt(encPrivKey), { access: account })`, `transferSync({ …, feePayer: sponsor })`. Map errors with `isLimitExceeded` to `SpendingLimitExceededError` after `getRemainingLimit`. |
| `settle` | `operatorClient.writeContract({ address: SETTLEMENT, abi, functionName: items.length > 1 ? 'settleMany' : 'settle', args, feePayer: sponsor, gas: 2_000_000n })`, then `waitForTransactionReceipt` |
| `returnHeldTransfer` | `writeContract(... 'returnToSender', [receipt])` |
| `readGuardBalance` | `Actions.receivePolicy.getBlockedBalance(client, { receipt })` |
| `listHeldReceipts` | `client.getLogs({ address: Addresses.receivePolicyGuard, event: parseAbiItem('event TransferBlocked(address indexed token, address indexed receiver, uint64 indexed blockedNonce, uint256 amount, uint8 receiptVersion, bytes receipt)'), args: { receiver: depositsAccount }, fromBlock, toBlock, strict: true })` in ≤50k-block chunks, then `ReceivePolicyReceipt.decode` |
| `confirmDeposits` | `getTransactionReceipt` + `ReceivePolicyReceipt.fromTransactionReceipt` + decode; amount from `getBlockedBalance` or the log |
| `health` | `getChainId()` must equal 42431 |

`explorerUrl` is `https://explore.testnet.tempo.xyz/tx/${hash}`.

### Sim behaviour spec

- **State:** lives in Convex so both parties see it live. Tables:
  - `sim_balances {address, token, amount}`
  - `sim_keys {account, keyId, token, max, remaining, period, periodEnd, expiry, recipients[], revoked}`
  - `sim_receipts {id, receipt, amount, status}`
  - `sim_events {txHash, logIndex, name, args, blockNumber, timestamp}`
  - `sim_meta {seq, block}`
- **Deterministic tx hash:** `keccak256(toHex(`portunus-sim:${seq}:${method}:${stableJson(args)}`))`, where `seq` is a monotonic counter in `sim_meta`. Block number increments by 1 per transaction. `timestamp = simNow()`.
- **Finality:** the action awaits about 500 ms (`450 + (seq % 100)` ms) before committing. The UI shows "final in 0.5 s".
- **Clock:** `simNow() = Date.now() + sim_meta.clockOffsetMs`. Expose a "fast-forward 1 day" demo control that only moves the sim clock. Period rollover uses the sim clock. Live mode ignores it.
- **Rules to mirror exactly** (so the UI code paths match live):
  - Transfer to the deposits account or any virtual address of `SIM_MASTER_ID` creates a receipt (blockedReason `receivePolicy`), never a balance credit.
  - `ReceivePolicyReceipt.encode({...})` gives realistic receipt bytes.
  - Batch is all-or-nothing on any failure (for example insufficient balance raises `InsufficientBalance(available, required, token)`).
  - **Access-key pull:** reject if revoked (`KeyAlreadyRevoked`) or `simNow >= expiry` (`KeyExpired`). Reject if `to ∉ recipients` or selector ≠ transferWithMemo (`CallNotAllowed`). Roll over if `simNow >= periodEnd`. **If `amount > remaining`, throw `SpendingLimitExceededError` and record no transaction.** On success emit `AccessKeySpend` + `TransferWithMemo`.
  - A key id can never be authorized twice for the same account (`KeyAlreadyExists` / `KeyAlreadyRevoked`).
  - Settlement: each receipt is settled at most once. `charge + disputed ≤ amount`. Payouts only to `charges` or `originator`. Emit `ReceiptClaimed` + `Settled`.
- **Labelling:**
  - Every sim `TxResult` has `explorerUrl: null`.
  - The UI shows a persistent **"SIMULATED (no Tempo connection)"** badge and prefixes hashes with `sim:`.
  - Never show sim records as on-chain.
- **Mode selection:**
  - `TEMPO_MODE` (Convex env) and `PUBLIC_TEMPO_MODE` (browser), default `sim`.
  - A health check on page load shows the mode.
  - **Never auto-switch** mid-flow, because ledgers must not mix. Store `mode` on every Convex payment row.

### One-time live setup

`web/scripts/setup-tempo.ts`, plain Node with `node --experimental-strip-types` or `tsx`. Run it on a networked machine. It must be idempotent. Steps:

1. Generate or load keys: sponsor, operator, line deposits, line charges, resolver. Save them to a gitignored `.state/tempo.json`.
2. Faucet-fund the sponsor and operator.
3. Mine the deposits-account salt (`mineSaltAsync`, about 15 min on 4 cores; offline-capable). Then `registerMasterSync` (sponsored).
4. Compile and deploy `PortunusSettlement` from the operator.
5. `receivePolicy.setSync({ senderPolicyId: 'reject-all', tokenPolicyId: 'allow-all', claimer: settlement })` from the deposits account (sponsored).
6. Verify with `receivePolicy.get` and `virtualAddress.getMasterAddress`.
7. Print the `npx convex env set …` lines and the public config.

Additional lines need their own mined master (about 15 min each). In the demo, provision one live line; other lines are sim-only.

---

## 12. Open questions and things not verified

1. **Nothing was executed against Moderato** (RPC blocked). Every live call is checked against types, library source, docs and held's live logs only. Run the setup script and a smoke test (faucet → batch deposit → settle → access-key pull ×2) on a networked machine first.
2. Whether **`https://sponsor.moderato.tempo.xyz`** is up, and which fee token it charges.
3. Whether viem's `Relay.create` / `Relay.feePayer` runs in **Convex's default (non-node) runtime** for the `httpAction` relay. Fallback: the public sponsor URL.
4. **Zero-amount `transferWithMemo`** validity (`InvalidAmount`?). Avoid zero legs in the contract and do not use them as "no-op" calls.
5. The **one-prompt access-key authorization** (deferred `keyAuthorization` on the first pull) and the **pre-signed revoke** with a 2D `nonceKey` and deferred sponsor co-signature. Both are plausible from the spec and untested.
6. The exact viem error shape for `SpendingLimitExceeded` at estimation time (`ExecutionError.from` did not decode the bare selector offline). Use the regex check plus the remaining-limit pre-check.
7. `deployContract` with `feePayer`. Fallback: the operator pays its own fee in pathUSD.
8. Faucet amounts per token (undocumented). held assumes ≥100 pathUSD.
9. The Safari WebAuthn user-activation issue with `sendTransactionSync`, and the prepare-then-sign workaround (§3).
10. Convex `.env.local` values for an anonymous local deployment are inferred from CLI source, not observed. **Convex cannot run in this container at all**, so coding agents can only typecheck (`npx convex codegen --system-udfs --typecheck enable`, `npm run check`). Decide whether a Convex-free in-browser demo mode is also needed.
11. Local-currency mapping and FX risk (details.md §13), which is a product question.
12. The time between free-time end and the first daily pull is anchored to **authorization time** on-chain (period windows), not to calendar days. Schedule pulls at least 24 h apart from the first pull, or accept that a refusal can occur near window edges.

### Sources

- Installed packages: `web/node_modules/viem/tempo/*`, `web/node_modules/viem/chains/definitions/tempoModerato.ts`, `web/node_modules/viem/tokens/definitions/*`, `web/node_modules/ox/tempo/*`, `web/node_modules/convex/dist/cjs/cli/*`, `web/node_modules/convex-svelte/README.md`.
- Tempo docs source: `github.com/tempoxyz/docs`. Pages: `quickstart/connection-details`, `quickstart/faucet`, `guide/payments/{virtual-addresses,transfer-memos,sponsor-user-fees,configure-receive-policies,send-a-payment}`, `protocol/tip403/receive-policies`, `protocol/tip20/virtual-addresses`, `protocol/transactions/{AccountKeychain,spec-tempo-transaction}`, `protocol/tips/tip-1011`, `protocol/upgrades/t3…t12`, `guide/node/network-upgrades`, `accounts/{create,access-keys}`, `server/relay-handler`, `api/fee-payer`.
- held: `github.com/emilbob/held`. Files: `README.md`, `_state.md`, `contracts/HeldArbiter.sol`, `scripts/{setup-merchant,compile,lib,day2-virtual-address}.ts`, `docs/day1-testnet-run.log`, `docs/day2-virtual-address-run.log`, `server/indexer.ts`, `web/src/wallet.ts`.
- Offline verification scripts (not app code): `/tmp/claude-0/-home-user-Portunus/e0de40e7-9d0d-53c5-b85c-4b465e988f1a/scratchpad/verify/v1–v4.mjs`.
