// Compiles contracts/PortunusSettlement.sol with solc-js 0.8.28 (no Foundry needed).
// Same settings as the proven "held" project on Tempo Moderato: evmVersion cancun, optimizer 200 runs.
import solc from 'solc';
import { readFileSync } from 'node:fs';

export const CONTRACT_PATH = new URL('../../../contracts/PortunusSettlement.sol', import.meta.url);

export interface CompiledContract {
	abi: readonly Record<string, unknown>[];
	bytecode: `0x${string}`;
	evmVersion: string;
	solcVersion: string;
}

interface SolcError {
	severity: 'error' | 'warning' | 'info';
	formattedMessage: string;
}
interface SolcOutput {
	errors?: SolcError[];
	contracts: Record<
		string,
		Record<string, { abi: Record<string, unknown>[]; evm: { bytecode: { object: string } } }>
	>;
}

export function compileSettlement(source?: string): CompiledContract {
	const src = source ?? readFileSync(CONTRACT_PATH, 'utf8');
	const evmVersion = 'cancun';
	const input = {
		language: 'Solidity',
		sources: { 'PortunusSettlement.sol': { content: src } },
		settings: {
			optimizer: { enabled: true, runs: 200 },
			evmVersion,
			outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } }
		}
	};
	const out = JSON.parse(solc.compile(JSON.stringify(input))) as SolcOutput;
	const errors = (out.errors ?? []).filter((e) => e.severity === 'error');
	if (errors.length) {
		throw new Error(`solc failed:\n${errors.map((e) => e.formattedMessage).join('\n')}`);
	}
	const c = out.contracts['PortunusSettlement.sol']?.PortunusSettlement;
	if (!c) throw new Error('PortunusSettlement not found in solc output');
	return {
		abi: c.abi,
		bytecode: `0x${c.evm.bytecode.object}`,
		evmVersion,
		solcVersion: solc.version()
	};
}
