// One-time live setup for Tempo Moderato. Run on a networked machine:   pnpm setup:tempo
// Idempotent: every step is skipped when already done. State (testnet keys, deployment) lives in the
// gitignored web/.state/tempo.json. Flags:
//   --print       print the Convex env lines and public config from saved state, no network
//   --mine-only   generate keys and mine the virtual-address salt (offline, ~15 min on 4 cores), then stop
// Env: TEMPO_RPC_URL, MAX_HOLD_SECONDS (default 30 days), REDEPLOY=1 to redeploy the settlement contract.
//
// Steps (brief section 11):
//   1. keys: sponsor, operator, line deposits, line charges, resolver (+ AES key, virtual-address prefix)
//   2. faucet-fund the sponsor and operator
//   3. mine the deposits-account salt (proof of work)
//   4. register the deposits account as a virtual-address master (sponsored)
//   5. compile and deploy PortunusSettlement from the operator
//   6. receive policy on the deposits account: reject-all senders, recovery authority = the contract (sponsored)
//   7. verify, then print the `npx convex env set` lines and public config
import { keccak256 } from 'viem';
import { Abis, Account, Actions, VirtualMaster } from 'viem/tempo';
import {
	ALPHA_USD,
	CHAIN_ID,
	DEFAULT_RPC_URL,
	createAccountClient,
	createLiveClient,
	describeChainError,
	isRpcRateLimit,
	type Address
} from '../src/lib/shared/tempo/live';
import { settlementAbi, settlementBytecode } from '../src/lib/shared/tempo/settlementAbi';
import {
	STATE_FILE,
	addresses,
	convexEnvLines,
	ensureKeys,
	loadState,
	publicConfig,
	saveState
} from './lib/state';

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
const args = new Set(process.argv.slice(2));
const rpcUrl = process.env.TEMPO_RPC_URL || DEFAULT_RPC_URL;
const MIN_FUNDS = 100_000_000n; // 100 pathUSD (6 decimals)

async function retry<T>(label: string, fn: () => Promise<T>, tries = 6): Promise<T> {
	for (let i = 0; ; i++) {
		try {
			return await fn();
		} catch (e) {
			if (i >= tries || !isRpcRateLimit(e)) throw e;
			const wait = 1000 * (i + 1);
			log(`${label}: rate limited, retrying in ${wait} ms`);
			await new Promise((r) => setTimeout(r, wait));
		}
	}
}

function printOutput(s: ReturnType<typeof loadState>) {
	console.log(
		'\n=== Convex environment (run from web/, after `npx convex dev` has created a deployment) ==='
	);
	console.log('# These contain TESTNET private keys. Never reuse them anywhere else.');
	for (const l of convexEnvLines(s, { rpcUrl })) console.log(l);
	console.log('\n=== Public config (non-secret) ===');
	console.log(JSON.stringify(publicConfig(s, { rpcUrl }), null, 2));
	console.log(`\nState file: ${STATE_FILE.pathname}`);
}

const state = ensureKeys(loadState());
saveState(state);
const who = addresses(state);

if (args.has('--print')) {
	printOutput(state);
	process.exit(0);
}

log('sponsor ', who.sponsor);
log('operator', who.operator);
log('deposits', who.deposits, '(virtual-address master)');
log('charges ', who.charges);
log('resolver', who.resolver);

// ---- 3 (offline). Mine the salt first when asked, so it can run without a network.
async function mineSalt() {
	if (state.salt && state.masterId) {
		log('salt already mined, masterId', state.masterId);
		return;
	}
	const t = Date.now();
	for (let pass = 0; !state.salt; pass++) {
		log(`mining salt, pass ${pass} (2^32 tries; about 15 minutes on 4 cores)...`);
		let lastLog = 0;
		const r = await VirtualMaster.mineSaltAsync({
			address: who.deposits!,
			start: BigInt(pass) << 32n,
			onProgress: (p) => {
				if (Date.now() - lastLog > 15_000) {
					lastLog = Date.now();
					log(`  ${(p.progress * 100).toFixed(1)}% at ${(p.rate / 1e6).toFixed(1)} MH/s`);
				}
			}
		});
		if (r) Object.assign(state, { salt: r.salt, masterId: r.masterId });
	}
	saveState(state);
	log(`salt mined in ${((Date.now() - t) / 1000).toFixed(0)}s, masterId ${state.masterId}`);
}

if (args.has('--mine-only')) {
	await mineSalt();
	printOutput(state);
	process.exit(0);
}

const pub = createLiveClient({ rpcUrl });
const balanceOf = (
	account: Address,
	token: Address = '0x20c0000000000000000000000000000000000000'
) =>
	retry('balanceOf', () =>
		pub.readContract({
			address: token,
			abi: Abis.tip20,
			functionName: 'balanceOf',
			args: [account]
		})
	);

// ---- health
const chainId = await retry('chainId', () => pub.getChainId()).catch((e) => {
	console.error(`Cannot reach ${rpcUrl}: ${describeChainError(e)}`);
	console.error(
		'This step needs network access to Tempo Moderato. Keys are saved in .state/tempo.json; rerun when online (or use --mine-only to mine the salt offline first).'
	);
	process.exit(2);
});
if (chainId !== CHAIN_ID)
	throw new Error(`RPC ${rpcUrl} is chain ${chainId}, expected ${CHAIN_ID} (Moderato)`);
log('connected to Tempo Moderato, block', (await pub.getBlockNumber()).toString());

// ---- 2. faucet
for (const [name, address] of [
	['sponsor', who.sponsor!],
	['operator', who.operator!]
] as const) {
	if ((await balanceOf(address)) < MIN_FUNDS) {
		log(`funding ${name} from the faucet...`);
		await retry('faucet', () => Actions.faucet.fundSync(pub, { account: address }));
	}
	log(`${name} pathUSD balance`, (Number(await balanceOf(address)) / 1e6).toFixed(2));
}

const sponsor = Account.fromSecp256k1(state.sponsorKey!);
const operator = Account.fromSecp256k1(state.operatorKey!);
const deposits = Account.fromSecp256k1(state.depositsKey!);

// ---- 3. salt, 4. register master
await mineSalt();
const registered = await retry('getMasterAddress', () =>
	Actions.virtualAddress.getMasterAddress(pub, { masterId: state.masterId! }).catch(() => null)
);
if (registered?.toLowerCase() !== who.deposits!.toLowerCase()) {
	const depositsClient = createAccountClient({ rpcUrl, account: deposits });
	const { receipt } = await retry('registerMaster', () =>
		Actions.virtualAddress.registerMasterSync(depositsClient, {
			salt: state.salt!,
			feePayer: sponsor
		})
	);
	state.registeredTx = receipt.transactionHash;
	saveState(state);
	log('registered virtual-address master', state.masterId, receipt.transactionHash);
} else {
	log('master already registered', state.masterId);
}

// ---- 5. settlement contract
const codeHash = keccak256(settlementBytecode);
const maxHold = Number(process.env.MAX_HOLD_SECONDS || state.maxHoldSeconds || 30 * 86_400);
const needDeploy =
	!state.settlement ||
	!!process.env.REDEPLOY ||
	state.settlementCodeHash !== codeHash ||
	state.maxHoldSeconds !== maxHold;
if (needDeploy) {
	const operatorClient = createAccountClient({ rpcUrl, account: operator });
	log('deploying PortunusSettlement...');
	// The operator pays its own deploy fee (deployContract with a sponsor is unverified).
	const hash = await retry('deploy', () =>
		operatorClient.deployContract({
			abi: settlementAbi,
			bytecode: settlementBytecode,
			args: [who.deposits!, who.charges!, who.operator!, who.resolver!, ALPHA_USD, BigInt(maxHold)]
		})
	);
	const rc = await pub.waitForTransactionReceipt({ hash });
	if (rc.status !== 'success' || !rc.contractAddress) throw new Error('settlement deploy failed');
	Object.assign(state, {
		settlement: rc.contractAddress,
		settlementBlock: rc.blockNumber.toString(),
		settlementDeployTx: hash,
		settlementCodeHash: codeHash,
		maxHoldSeconds: maxHold
	});
	saveState(state);
	log('PortunusSettlement deployed', state.settlement, `maxHold ${maxHold}s`);
} else {
	log('PortunusSettlement already deployed', state.settlement);
}

// ---- 6. receive policy
const policy = await retry('receivePolicy.get', () =>
	Actions.receivePolicy.get(pub, { account: who.deposits! })
);
if (
	policy.recoveryAuthority.toLowerCase() !== state.settlement!.toLowerCase() ||
	policy.senderPolicyId !== 'reject-all'
) {
	const depositsClient = createAccountClient({ rpcUrl, account: deposits });
	const { receipt } = await retry('receivePolicy.set', () =>
		Actions.receivePolicy.setSync(depositsClient, {
			senderPolicyId: 'reject-all',
			tokenPolicyId: 'allow-all',
			claimer: state.settlement!,
			feePayer: sponsor
		})
	);
	state.policySetTx = receipt.transactionHash;
	saveState(state);
	log('receive policy set: hold all incoming, recovery authority = settlement contract');
} else {
	log('receive policy already set');
}

// ---- 7. verify
const finalPolicy = await Actions.receivePolicy.get(pub, { account: who.deposits! });
const master = await Actions.virtualAddress.getMasterAddress(pub, { masterId: state.masterId! });
const onChain = await Promise.all(
	(['depositsAccount', 'charges', 'operator', 'resolver', 'token'] as const).map((fn) =>
		pub.readContract({ address: state.settlement!, abi: settlementAbi, functionName: fn })
	)
);
const checks: [string, boolean][] = [
	['receive policy is reject-all', finalPolicy.senderPolicyId === 'reject-all'],
	[
		'recovery authority is the settlement contract',
		finalPolicy.recoveryAuthority.toLowerCase() === state.settlement!.toLowerCase()
	],
	[
		'master id resolves to the deposits account',
		master?.toLowerCase() === who.deposits!.toLowerCase()
	],
	[
		'contract immutables match',
		onChain.map((x) => x.toLowerCase()).join() ===
			[who.deposits, who.charges, who.operator, who.resolver, ALPHA_USD].join().toLowerCase()
	]
];
let ok = true;
for (const [name, pass] of checks) {
	log(pass ? 'OK  ' : 'FAIL', name);
	ok &&= pass;
}
printOutput(state);
if (!ok) {
	console.error('\nSetup verification failed. See the FAIL lines above.');
	process.exit(1);
}
log('setup complete');
process.exit(0);
