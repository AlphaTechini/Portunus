/**
 * Validation of Convex values against exported validator JSON (`fn.exportArgs()` and
 * `schema.tables[t].validator.json`). Returns an error message or null.
 */
import { jsonToConvex } from 'convex/values';

export type ValidatorJson = {
	type: string;
	tableName?: string;
	value?: unknown;
	keys?: ValidatorJson;
	values?: { fieldType: ValidatorJson; optional?: boolean };
};

export interface ValidateCtx {
	/** Table an id belongs to (null if not a valid id). */
	tableOfId: (id: string) => string | null;
}

function describe(v: unknown): string {
	if (v === null) return 'null';
	if (Array.isArray(v)) return 'array';
	if (v instanceof ArrayBuffer) return 'bytes';
	return typeof v === 'bigint' ? 'bigint' : typeof v;
}

export function validateValue(
	validator: ValidatorJson,
	value: unknown,
	ctx: ValidateCtx,
	path = ''
): string | null {
	const at = path ? ` at path ${path}` : '';
	switch (validator.type) {
		case 'any':
			return null;
		case 'null':
			return value === null
				? null
				: `Value does not match validator${at}: expected null, got ${describe(value)}`;
		case 'number':
			return typeof value === 'number'
				? null
				: `Value does not match validator${at}: expected number, got ${describe(value)}`;
		case 'bigint':
			return typeof value === 'bigint'
				? null
				: `Value does not match validator${at}: expected bigint, got ${describe(value)}`;
		case 'boolean':
			return typeof value === 'boolean'
				? null
				: `Value does not match validator${at}: expected boolean, got ${describe(value)}`;
		case 'string':
			return typeof value === 'string'
				? null
				: `Value does not match validator${at}: expected string, got ${describe(value)}`;
		case 'bytes':
			return value instanceof ArrayBuffer
				? null
				: `Value does not match validator${at}: expected bytes, got ${describe(value)}`;
		case 'id': {
			if (typeof value !== 'string')
				return `Value does not match validator${at}: expected id of "${validator.tableName}", got ${describe(value)}`;
			const t = ctx.tableOfId(value);
			return t === validator.tableName
				? null
				: `Value does not match validator${at}: expected id of table "${validator.tableName}", got "${value}"`;
		}
		case 'literal': {
			const lit = jsonToConvex(validator.value as never);
			return lit === value
				? null
				: `Value does not match validator${at}: expected literal ${JSON.stringify(typeof lit === 'bigint' ? String(lit) : lit)}, got ${describe(value)}`;
		}
		case 'array': {
			if (!Array.isArray(value))
				return `Value does not match validator${at}: expected array, got ${describe(value)}`;
			for (let i = 0; i < value.length; i++) {
				const e = validateValue(validator.value as ValidatorJson, value[i], ctx, `${path}[${i}]`);
				if (e) return e;
			}
			return null;
		}
		case 'record': {
			if (
				value === null ||
				typeof value !== 'object' ||
				Array.isArray(value) ||
				value instanceof ArrayBuffer
			) {
				return `Value does not match validator${at}: expected record, got ${describe(value)}`;
			}
			for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
				if (v === undefined) continue;
				const ek = validateValue(validator.keys as ValidatorJson, k, ctx, `${path}.${k}`);
				if (ek) return ek;
				const ev = validateValue(validator.values!.fieldType, v, ctx, `${path}.${k}`);
				if (ev) return ev;
			}
			return null;
		}
		case 'union': {
			const members = validator.value as ValidatorJson[];
			let firstErr: string | null = null;
			for (const m of members) {
				const e = validateValue(m, value, ctx, path);
				if (e === null) return null;
				firstErr ??= e;
			}
			return `Value does not match any variant of v.union()${at}${firstErr ? ` (e.g. ${firstErr})` : ''}`;
		}
		case 'object': {
			if (
				value === null ||
				typeof value !== 'object' ||
				Array.isArray(value) ||
				value instanceof ArrayBuffer
			) {
				return `Value does not match validator${at}: expected object, got ${describe(value)}`;
			}
			const fields = validator.value as Record<
				string,
				{ fieldType: ValidatorJson; optional: boolean }
			>;
			const obj = value as Record<string, unknown>;
			for (const [k, f] of Object.entries(fields)) {
				const v = obj[k];
				if (v === undefined) {
					if (!f.optional) {
						return `Object${at} is missing the required field \`${k}\`. Consider wrapping the field validator in \`v.optional(...)\` if this is expected.`;
					}
					continue;
				}
				const e = validateValue(f.fieldType, v, ctx, `${path}.${k}`);
				if (e) return e;
			}
			for (const k of Object.keys(obj)) {
				if (obj[k] !== undefined && !(k in fields)) {
					return `Object${at} contains extra field \`${k}\` that is not in the validator.`;
				}
			}
			return null;
		}
		default:
			return null;
	}
}
