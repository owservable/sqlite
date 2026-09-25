'use strict';

import {raw} from '@mikro-orm/core';
import {each, isEmpty, isPlainObject, isString, setWith} from 'lodash';

export class UntranslatableQueryError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'UntranslatableQueryError';
	}
}

export type TranslateQueryOptions = {regex: boolean};

type ConditionHandler = (value: any, condition: any, options: TranslateQueryOptions) => [string, any] | null;
type KeyHandler = (translated: any, key: string, value: any, meta: any, options: TranslateQueryOptions, root: boolean) => void;

const UNSAFE_KEYS: string[] = ['__proto__', 'constructor', 'prototype'];
const COMPARISON_OPERATORS: string[] = ['$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$like', '$ilike'];
const LIST_OPERATORS: string[] = ['$in', '$nin'];
const JSON_OPERATORS: string[] = ['$overlap', '$contains', '$contained', '$hasKey', '$hasKeys', '$hasSomeKeys'];
const LOGICAL_OPERATORS: string[] = ['$and', '$or', '$nor', '$expr'];
const EXISTS_VALUES: any[] = [true, false, 1, 0];
const PCRE_HEX_ESCAPE: RegExp = /\\x([0-9a-fA-F]{2})/g;

const untranslatable = (message: string): never => {
	throw new UntranslatableQueryError(message);
};

const assertSafeKey = (key: string): void => {
	if (UNSAFE_KEYS.includes(key)) throw new Error(`Unsafe query key '${key}'`);
};

const isMatchAll = (query: any): boolean => Reflect.ownKeys(query).length === 0;

const isFieldOperator = (key: string): boolean => key.startsWith('$') && !LOGICAL_OPERATORS.includes(key);

const decodeHexEscape = (_match: string, hex: string): string => {
	const char: string = String.fromCharCode(parseInt(hex, 16));
	return /[0-9a-zA-Z]/.test(char) ? char : `\\${char}`;
};

const assertRegexSupported = (options: TranslateQueryOptions): void => {
	if (!options.regex) untranslatable('Regular expressions are not supported by this backend');
};

const toRegex = (pattern: any, flags: any, options: TranslateQueryOptions): string => {
	assertRegexSupported(options);
	const isRegExp: boolean = pattern instanceof RegExp;
	const source: any = isRegExp ? pattern.source : pattern;
	if (!isString(source)) untranslatable('$regex requires a string pattern');
	if (undefined !== flags && !isString(flags)) untranslatable('$options must be a string');

	const allFlags: string = `${isRegExp ? pattern.flags : ''}${flags ?? ''}`;
	const unsupported: string = allFlags.replace(/[ig]/g, '');
	if (unsupported) untranslatable(`Unsupported regex options '${unsupported}'`);

	const translated: string = source.replace(PCRE_HEX_ESCAPE, decodeHexEscape);
	return allFlags.includes('i') ? `(?i)${translated}` : translated;
};

const scalarHandler =
	(operator: string): ConditionHandler =>
	(value: any): [string, any] => {
		if (isPlainObject(value) || Array.isArray(value)) untranslatable(`${operator} requires a scalar value`);
		return [operator, value];
	};

const listHandler =
	(operator: string): ConditionHandler =>
	(value: any): [string, any] => {
		if (!Array.isArray(value)) untranslatable(`${operator} requires an array`);
		return [operator, value];
	};

const passHandler =
	(operator: string): ConditionHandler =>
	(value: any): [string, any] => [operator, value];

const CONDITION_HANDLERS: Map<string, ConditionHandler> = new Map<string, ConditionHandler>([
	...COMPARISON_OPERATORS.map((operator: string): [string, ConditionHandler] => [operator, scalarHandler(operator)]),
	...LIST_OPERATORS.map((operator: string): [string, ConditionHandler] => [operator, listHandler(operator)]),
	...JSON_OPERATORS.map((operator: string): [string, ConditionHandler] => [operator, passHandler(operator)]),
	['$regex', (value: any, condition: any, options: TranslateQueryOptions): [string, any] => ['$re', toRegex(value, condition.$options, options)]],
	['$options', (_value: any, condition: any): null => ('$regex' in condition ? null : untranslatable('$options requires $regex'))],
	[
		'$re',
		(value: any, _condition: any, options: TranslateQueryOptions): [string, any] => {
			assertRegexSupported(options);
			if (!isString(value)) untranslatable('$re requires a string');
			return ['$re', value];
		}
	],
	[
		'$exists',
		(value: any): [string, any] => {
			if (!EXISTS_VALUES.includes(value)) untranslatable('$exists requires a boolean');
			return [value ? '$ne' : '$eq', null];
		}
	],
	[
		'$not',
		(value: any, _condition: any, options: TranslateQueryOptions): [string, any] => {
			if (!isPlainObject(value) || isEmpty(value) || !Object.keys(value).every(isFieldOperator)) untranslatable('$not requires an operator object');
			return ['$not', translateCondition(value, options)];
		}
	]
]);

const translateCondition = (condition: any, options: TranslateQueryOptions): any => {
	const translated: any = {};
	each(Object.keys(condition), (key: string): void => {
		assertSafeKey(key);
		const handler: ConditionHandler | undefined = CONDITION_HANDLERS.get(key);
		if (!handler) untranslatable(`Unsupported operator '${key}'`);

		const entry: [string, any] | null = handler!(condition[key], condition, options);
		if (!entry) return;
		if (entry[0] in translated) untranslatable(`Conflicting '${entry[0]}' conditions`);
		translated[entry[0]] = entry[1];
	});
	return translated;
};

const translateFieldValue = (value: any, property: any, options: TranslateQueryOptions): any => {
	if (value instanceof RegExp) return {$re: toRegex(value, undefined, options)};
	if (Array.isArray(value)) untranslatable('Array equality is not supported, use $in');
	if (!isPlainObject(value)) return value;

	const keys: string[] = Object.keys(value);
	if (isEmpty(keys)) untranslatable('Empty condition object');
	if (keys.every(isFieldOperator)) return translateCondition(value, options);
	if (keys.some(isFieldOperator)) untranslatable('Operators and fields cannot be mixed');
	return translateObject(value, property?.targetMeta, options, false);
};

const merge = (translated: any, key: string, condition: any): void => {
	if (key in translated) translated.$and = [...(translated.$and ?? []), {[key]: condition}];
	else translated[key] = condition;
};

const mergeMatchNothing = (translated: any, meta: any): void => {
	const pk: string = meta?.primaryKeys?.[0];
	if (!pk) untranslatable('Cannot express a condition that matches nothing without a primary key');
	merge(translated, pk, {$in: []});
};

const translateBranches = (value: any, meta: any, options: TranslateQueryOptions, root: boolean, operator: string): any[] => {
	if (!Array.isArray(value)) untranslatable(`${operator} requires an array`);
	return value.map((branch: any): any => translateObject(branch, meta, options, root));
};

const tryTranslateBranch = (branch: any, meta: any, options: TranslateQueryOptions, root: boolean): any => {
	if (!isPlainObject(branch)) untranslatable('$or branches must be objects');
	try {
		return translateObject(branch, meta, options, root);
	} catch (error) {
		if (error instanceof UntranslatableQueryError) return null;
		throw error;
	}
};

const handleAnd: KeyHandler = (translated, key, value, meta, options, root): void => {
	const branches: any[] = translateBranches(value, meta, options, root, key).filter((branch: any): boolean => !isMatchAll(branch));
	if (branches.length) translated.$and = [...(translated.$and ?? []), ...branches];
};

const handleOr: KeyHandler = (translated, _key, value, meta, options, root): void => {
	if (!Array.isArray(value)) untranslatable('$or requires an array');
	const branches: any[] = value.map((branch: any): any => tryTranslateBranch(branch, meta, options, root));
	if (branches.some((branch: any): boolean => null !== branch && isMatchAll(branch))) return;

	const kept: any[] = branches.filter((branch: any): boolean => null !== branch);
	if (kept.length) merge(translated, '$or', kept);
	else mergeMatchNothing(translated, meta);
};

const handleNor: KeyHandler = (translated, key, value, meta, options, root): void => {
	const branches: any[] = translateBranches(value, meta, options, root, key);
	if (branches.some(isMatchAll)) mergeMatchNothing(translated, meta);
	else merge(translated, key, branches);
};

const handleExpr: KeyHandler = (translated, _key, expr, meta, options, root): void => {
	if (!root) untranslatable('$expr is only supported on the root entity');
	const match: any = expr?.$regexMatch;
	const input: any = match?.input?.$toString;
	if (!isPlainObject(expr) || Object.keys(expr).length !== 1 || !isString(input) || !input.startsWith('$')) untranslatable('Unsupported $expr');

	const fieldName: string = meta?.properties?.[input.substring(1)]?.fieldNames?.[0];
	if (!fieldName) untranslatable(`Unknown $expr field '${input}'`);
	translated[raw(`cast("${fieldName}" as text)`) as any] = {$re: toRegex(match.regex, match.options, options)};
};

const handleUnsupported: KeyHandler = (_translated, key): void => {
	untranslatable(`Unsupported operator '${key}'`);
};

const handleField: KeyHandler = (translated, key, value, meta, options): void => {
	const path: string[] = key.split('.');
	if (path.some((segment: string): boolean => !segment)) untranslatable(`Invalid field path '${key}'`);
	each(path, assertSafeKey);

	const [head, ...rest] = path;
	const property: string = '_id' === head && meta ? meta.primaryKeys[0] : head;
	const nested: any = rest.length ? setWith({}, rest, value, Object) : value;
	merge(translated, property, translateFieldValue(nested, meta?.properties?.[property], options));
};

const KEY_HANDLERS: Map<string, KeyHandler> = new Map<string, KeyHandler>([
	['$and', handleAnd],
	['$or', handleOr],
	['$nor', handleNor],
	['$expr', handleExpr]
]);

const translateObject = (query: any, meta: any, options: TranslateQueryOptions, root: boolean): any => {
	if (!isPlainObject(query)) untranslatable('Query must be an object');

	const translated: any = {};
	each(Object.keys(query), (key: string): void => {
		assertSafeKey(key);
		const handler: KeyHandler = KEY_HANDLERS.get(key) ?? (key.startsWith('$') ? handleUnsupported : handleField);
		handler(translated, key, query[key], meta, options, root);
	});
	return translated;
};

export default function translateQuery(query: any, meta: any, options: TranslateQueryOptions): any {
	if (!query || isString(query)) return query;
	return translateObject(query, meta, options, true);
}
