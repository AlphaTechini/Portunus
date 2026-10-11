import { getContext, setContext } from 'svelte';

export interface FieldContext {
	readonly id: string;
	readonly describedBy: string | undefined;
	readonly invalid: boolean;
	readonly required: boolean;
	readonly disabled: boolean;
}

const KEY = Symbol('portunus-field');

export function setFieldContext(ctx: FieldContext) {
	setContext(KEY, ctx);
}

export function getFieldContext(): FieldContext | undefined {
	return getContext<FieldContext | undefined>(KEY);
}
