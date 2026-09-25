'use strict';

import translateQuery, {UntranslatableQueryError} from '../../src/functions/translate.query';

jest.mock('@mikro-orm/core', () => ({raw: jest.fn((sql: string): any => Symbol(sql))}));

const personMeta: any = {
	primaryKeys: ['uuid'],
	properties: {uuid: {fieldNames: ['uuid']}, first_name: {fieldNames: ['first_name']}}
};
const userMeta: any = {
	primaryKeys: ['id'],
	properties: {id: {fieldNames: ['id']}, person: {fieldNames: ['person'], targetMeta: personMeta}}
};
const typeMeta: any = {
	primaryKeys: ['type_pk'],
	properties: {type_pk: {fieldNames: ['type_pk']}, name: {fieldNames: ['name']}}
};
const meta: any = {
	primaryKeys: ['id'],
	properties: {
		id: {fieldNames: ['id']},
		name: {fieldNames: ['name']},
		amount: {fieldNames: ['amount']},
		data: {fieldNames: ['data']},
		type_id: {fieldNames: ['type_id'], targetMeta: typeMeta},
		keyless: {fieldNames: ['keyless'], targetMeta: {properties: {name: {fieldNames: ['name']}}}},
		virtual: {},
		created_by: {fieldNames: ['created_by'], targetMeta: userMeta}
	}
};

const regex: any = {regex: true};
const noRegex: any = {regex: false};
const translate = (query: any, options: any = regex): any => translateQuery(query, meta, options);
const translating =
	(query: any, options: any = regex): (() => any) =>
	(): any =>
		translate(query, options);
const exprKey = (where: any): any => Reflect.ownKeys(where).find((key: any): boolean => typeof key === 'symbol');

describe('translate.query tests', () => {
	describe('passthrough', () => {
		it.each([undefined, null, '', 'some-id'])('should return %p as is', (query: any) => {
			expect(translate(query)).toBe(query);
		});

		it('should return an empty object for an empty query', () => {
			expect(translate({})).toEqual({});
		});

		it('should keep scalar equality, null, booleans and dates', () => {
			const date: Date = new Date(0);
			expect(translate({name: 'x', amount: 5, data: null, active: true, created: date})).toEqual({name: 'x', amount: 5, data: null, active: true, created: date});
		});
	});

	describe('_id', () => {
		it('should map _id to the primary key', () => {
			expect(translate({_id: 7})).toEqual({id: 7});
		});

		it('should map _id with operators', () => {
			expect(translate({_id: {$in: [1, 2]}})).toEqual({id: {$in: [1, 2]}});
		});

		it('should map _id inside a relation to the target primary key', () => {
			expect(translate({type_id: {_id: 'x'}})).toEqual({type_id: {type_pk: 'x'}});
		});

		it('should keep _id inside a non-relation object', () => {
			expect(translate({data: {_id: 'x'}})).toEqual({data: {_id: 'x'}});
		});
	});

	describe('operators', () => {
		it.each(['$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$like', '$ilike'])('should pass %s through', (operator: string) => {
			expect(translate({name: {[operator]: 'a'}})).toEqual({name: {[operator]: 'a'}});
		});

		it.each(['$overlap', '$contains', '$contained', '$hasKey', '$hasKeys', '$hasSomeKeys'])('should pass JSON operator %s through', (operator: string) => {
			expect(translate({data: {[operator]: ['a']}})).toEqual({data: {[operator]: ['a']}});
		});

		it('should combine several operators on one field', () => {
			expect(translate({amount: {$gte: 5, $lte: 9}})).toEqual({amount: {$gte: 5, $lte: 9}});
		});

		it.each(['$in', '$nin'])('should pass %s arrays through', (operator: string) => {
			expect(translate({name: {[operator]: ['a', 'b']}})).toEqual({name: {[operator]: ['a', 'b']}});
		});

		it.each(['$in', '$nin'])('should reject %s without an array', (operator: string) => {
			expect(translating({name: {[operator]: 'a'}})).toThrow(UntranslatableQueryError);
		});

		it.each([{a: 1}, ['a']])('should reject comparison operands that are objects or arrays: %p', (operand: any) => {
			expect(translating({name: {$eq: operand}})).toThrow(UntranslatableQueryError);
		});

		it.each([
			[true, {$ne: null}],
			[1, {$ne: null}],
			[false, {$eq: null}],
			[0, {$eq: null}]
		])('should translate $exists %p', (value: any, expected: any) => {
			expect(translate({name: {$exists: value}})).toEqual({name: expected});
		});

		it.each(['yes', null, {}])('should reject $exists with non-boolean %p', (value: any) => {
			expect(translating({name: {$exists: value}})).toThrow(UntranslatableQueryError);
		});

		it('should reject $exists colliding with the same operator', () => {
			expect(translating({name: {$exists: true, $ne: 'x'}})).toThrow(UntranslatableQueryError);
		});

		it('should translate $not with nested operators', () => {
			expect(translate({name: {$not: {$regex: 'a', $options: 'i'}}})).toEqual({name: {$not: {$re: '(?i)a'}}});
			expect(translate({amount: {$not: {$gt: 5}}})).toEqual({amount: {$not: {$gt: 5}}});
		});

		it.each(['a', {}, {name: 1}])('should reject $not with %p', (value: any) => {
			expect(translating({name: {$not: value}})).toThrow(UntranslatableQueryError);
		});

		it.each(['$type', '$size', '$all', '$elemMatch', '$mod', '$where', '$text', '$unknown'])('should reject field operator %s instead of dropping it', (operator: string) => {
			expect(translating({name: {[operator]: 1}})).toThrow(UntranslatableQueryError);
		});

		it('should reject operators mixed with fields', () => {
			expect(translating({type_id: {$eq: 'x', name: 'y'}})).toThrow(UntranslatableQueryError);
		});

		it('should reject an empty condition object', () => {
			expect(translating({name: {}})).toThrow(UntranslatableQueryError);
		});

		it('should reject array equality', () => {
			expect(translating({name: ['a', 'b']})).toThrow(UntranslatableQueryError);
		});

		it.each(['$where', '$text', '$comment', '$unknown', '$not'])('should reject top-level operator %s', (operator: string) => {
			expect(translating({[operator]: 'x'})).toThrow(UntranslatableQueryError);
		});
	});

	describe('regex', () => {
		it('should translate $regex with $options i into inline case-insensitive $re', () => {
			expect(translate({name: {$regex: '^Jo', $options: 'i'}, amount: {$regex: 'x$'}})).toEqual({name: {$re: '(?i)^Jo'}, amount: {$re: 'x$'}});
		});

		it('should decode PCRE hex escapes into safe literals', () => {
			expect(translate({name: {$regex: 'row\\x2dtwo\\x61\\x24', $options: 'i'}})).toEqual({name: {$re: '(?i)row\\-twoa\\$'}});
		});

		it('should translate RegExp values and RegExp $regex', () => {
			expect(translate({name: /^a/i})).toEqual({name: {$re: '(?i)^a'}});
			expect(translate({name: {$regex: /b$/}})).toEqual({name: {$re: 'b$'}});
		});

		it('should reject a non-string $re', () => {
			expect(translating({name: {$re: 5}})).toThrow(UntranslatableQueryError);
		});

		it('should pass native $re through', () => {
			expect(translate({name: {$re: '^a'}})).toEqual({name: {$re: '^a'}});
		});

		it('should reject $options without $regex', () => {
			expect(translating({name: {$options: 'i'}})).toThrow(UntranslatableQueryError);
		});

		it.each(['m', 's', 'x', 'im'])('should reject unsupported regex option %p', (options: string) => {
			expect(translating({name: {$regex: 'a', $options: options}})).toThrow(UntranslatableQueryError);
		});

		it('should reject non-string $regex and $options', () => {
			expect(translating({name: {$regex: 5}})).toThrow(UntranslatableQueryError);
			expect(translating({name: {$regex: 'a', $options: 5}})).toThrow(UntranslatableQueryError);
		});

		it('should reject every regex form when the backend has no regex support', () => {
			expect(translating({name: {$regex: 'a'}}, noRegex)).toThrow(UntranslatableQueryError);
			expect(translating({name: /a/}, noRegex)).toThrow(UntranslatableQueryError);
			expect(translating({name: {$re: 'a'}}, noRegex)).toThrow(UntranslatableQueryError);
			expect(translating({$expr: {$regexMatch: {input: {$toString: '$amount'}, regex: '7'}}}, noRegex)).toThrow(UntranslatableQueryError);
		});
	});

	describe('relations', () => {
		it('should translate nested relation conditions', () => {
			expect(translate({type_id: {name: {$regex: 'kol', $options: 'i'}}})).toEqual({type_id: {name: {$re: '(?i)kol'}}});
		});

		it('should translate three levels of nested relations', () => {
			expect(translate({created_by: {person: {first_name: {$ilike: '%a%'}, _id: 'p'}}})).toEqual({created_by: {person: {first_name: {$ilike: '%a%'}, uuid: 'p'}}});
		});

		it('should keep relation equality and operators on the foreign key', () => {
			expect(translate({type_id: 'x'})).toEqual({type_id: 'x'});
			expect(translate({type_id: {$in: ['x', 'y']}})).toEqual({type_id: {$in: ['x', 'y']}});
		});

		it('should translate logical operators inside a relation', () => {
			expect(translate({type_id: {$or: [{name: {$regex: 'a'}}, {_id: 'x'}]}})).toEqual({type_id: {$or: [{name: {$re: 'a'}}, {type_pk: 'x'}]}});
		});
	});

	describe('dotted keys', () => {
		it('should nest dotted keys', () => {
			expect(translate({'type_id.name': {$ilike: '%a%'}})).toEqual({type_id: {name: {$ilike: '%a%'}}});
		});

		it('should nest dotted keys over several relations and map _id at the leaf', () => {
			expect(translate({'created_by.person._id': 'p'})).toEqual({created_by: {person: {uuid: 'p'}}});
		});

		it('should nest objects under fields unknown to the metadata', () => {
			expect(translate({unknown: {x: 1}})).toEqual({unknown: {x: 1}});
		});

		it('should nest dotted keys into non-relation objects', () => {
			expect(translate({'data.x': 1})).toEqual({data: {x: 1}});
		});

		it('should combine two dotted keys on one relation with $and', () => {
			expect(translate({'type_id.name': 'a', 'type_id._id': 'x'})).toEqual({type_id: {name: 'a'}, $and: [{type_id: {type_pk: 'x'}}]});
		});

		it('should combine a dotted key with a nested object on one relation with $and', () => {
			expect(translate({type_id: {name: 'a'}, 'type_id.name': 'b'})).toEqual({type_id: {name: 'a'}, $and: [{type_id: {name: 'b'}}]});
		});

		it('should combine a dotted key with a foreign key equality with $and', () => {
			expect(translate({type_id: 'x', 'type_id.name': 'b'})).toEqual({type_id: 'x', $and: [{type_id: {name: 'b'}}]});
		});

		it('should append an explicit $and after earlier collisions', () => {
			expect(translate({type_id: 'x', 'type_id.name': 'b', $and: [{amount: 1}]})).toEqual({type_id: 'x', $and: [{type_id: {name: 'b'}}, {amount: 1}]});
		});

		it('should append collisions to an explicit $and', () => {
			expect(translate({$and: [{amount: 1}], type_id: 'x', 'type_id.name': 'b'})).toEqual({$and: [{amount: 1}, {type_id: {name: 'b'}}], type_id: 'x'});
		});

		it.each(['a..b', '.a', 'a.', '.'])('should reject invalid path %p', (key: string) => {
			expect(translating({[key]: 1})).toThrow(UntranslatableQueryError);
		});
	});

	describe('logical operators', () => {
		it('should translate $and branches and drop empty ones', () => {
			expect(translate({$and: [{_id: 3}, {}, {name: {$regex: 'a'}}]})).toEqual({$and: [{id: 3}, {name: {$re: 'a'}}]});
		});

		it('should drop $and when every branch is empty', () => {
			expect(translate({$and: [{}, {}]})).toEqual({});
		});

		it.each(['$and', '$or', '$nor'])('should reject %s without an array', (operator: string) => {
			expect(translating({[operator]: {name: 1}})).toThrow(UntranslatableQueryError);
		});

		it.each(['$and', '$or', '$nor'])('should reject %s with a non-object branch', (operator: string) => {
			expect(translating({[operator]: ['raw']})).toThrow(UntranslatableQueryError);
		});

		it('should reject an untranslatable $and branch instead of dropping it', () => {
			expect(translating({$and: [{name: 'a'}, {name: {$type: 'string'}}]})).toThrow(UntranslatableQueryError);
		});

		it('should drop untranslatable $or branches, narrowing the result', () => {
			expect(translate({$or: [{name: {$type: 'string'}}, {name: {$regex: 'a', $options: 'i'}}]})).toEqual({$or: [{name: {$re: '(?i)a'}}]});
		});

		it('should match nothing when no $or branch is translatable', () => {
			expect(translate({$or: [{name: {$type: 'string'}}]})).toEqual({id: {$in: []}});
			expect(translate({$or: []})).toEqual({id: {$in: []}});
		});

		it('should match nothing through the relation primary key inside a relation', () => {
			expect(translate({type_id: {$or: [{name: {$type: 'string'}}]}})).toEqual({type_id: {type_pk: {$in: []}}});
		});

		it('should reject a match-nothing $or where no primary key is known', () => {
			expect(translating({data: {$or: [{x: {$type: 1}}]}})).toThrow(UntranslatableQueryError);
			expect(translating({keyless: {$or: [{name: {$type: 1}}]}})).toThrow(UntranslatableQueryError);
			expect(() => translateQuery({$or: []}, undefined, regex)).toThrow(UntranslatableQueryError);
		});

		it('should drop $or when a branch matches everything', () => {
			expect(translate({name: 'a', $or: [{}, {amount: 1}]})).toEqual({name: 'a'});
		});

		it('should reject an untranslatable $nor branch instead of dropping it', () => {
			expect(translating({$nor: [{name: 'a'}, {name: {$type: 'string'}}]})).toThrow(UntranslatableQueryError);
		});

		it('should translate $nor branches', () => {
			expect(translate({$nor: [{_id: 3}]})).toEqual({$nor: [{id: 3}]});
		});

		it('should match nothing when a $nor branch matches everything', () => {
			expect(translate({$nor: [{}, {amount: 1}]})).toEqual({id: {$in: []}});
		});
	});

	describe('$expr', () => {
		it('should translate regexMatch on a root field into a cast-to-text regex condition', () => {
			const where: any = translate({$expr: {$regexMatch: {input: {$toString: '$amount'}, regex: '7', options: 'i'}}});
			const key: any = exprKey(where);
			expect(String(key.description)).toBe('cast("amount" as text)');
			expect(where[key]).toEqual({$re: '(?i)7'});
		});

		it('should translate regexMatch inside $or next to other branches', () => {
			const where: any = translate({$or: [{$expr: {$regexMatch: {input: {$toString: '$amount'}, regex: '7'}}}, {name: {$regex: '7'}}]});
			expect(where.$or).toHaveLength(2);
			expect(where.$or[1]).toEqual({name: {$re: '7'}});
		});

		it.each([
			null,
			{$unknownOp: 1},
			{$regexMatch: {input: {$toString: 'amount'}, regex: '7'}},
			{$regexMatch: {input: {$toString: '$ghost'}, regex: '7'}},
			{$regexMatch: {input: '$amount', regex: '7'}},
			{$regexMatch: {input: {$toString: '$amount'}, regex: '7'}, $extra: 1}
		])('should reject unsupported $expr %p instead of dropping it', (expr: any) => {
			expect(translating({$expr: expr})).toThrow(UntranslatableQueryError);
		});

		it('should reject $expr when the field has no column or no metadata is known', () => {
			const expr: any = {$regexMatch: {input: {$toString: '$virtual'}, regex: '7'}};
			expect(translating({$expr: expr})).toThrow(UntranslatableQueryError);
			expect(() => translateQuery({$expr: expr}, undefined, regex)).toThrow(UntranslatableQueryError);
			expect(() => translateQuery({$expr: expr}, {primaryKeys: ['id']}, regex)).toThrow(UntranslatableQueryError);
		});

		it('should drop an unsupported $expr inside $or', () => {
			expect(translate({$or: [{$expr: {$unknownOp: 1}}, {name: 'a'}]})).toEqual({$or: [{name: 'a'}]});
		});

		it('should reject $expr inside a relation', () => {
			expect(translating({type_id: {$expr: {$regexMatch: {input: {$toString: '$name'}, regex: '7'}}}})).toThrow(UntranslatableQueryError);
		});
	});

	describe('unsafe keys', () => {
		it.each([
			'{"__proto__": {"id": 1}}',
			'{"constructor": 1}',
			'{"prototype": 1}',
			'{"name": {"__proto__": {"$eq": 1}}}',
			'{"type_id": {"__proto__": {"name": 1}}}',
			'{"type_id.__proto__.x": 1}',
			'{"constructor.prototype.polluted": 1}',
			'{"$or": [{"__proto__": {"x": 1}}, {"name": "a"}]}',
			'{"$and": [{"prototype": 1}]}'
		])('should throw on %s and never drop it', (json: string) => {
			const query: any = JSON.parse(json);
			expect(translating(query)).toThrow('Unsafe query key');
			expect(translating(query)).not.toThrow(UntranslatableQueryError);
		});

		it('should not pollute prototypes', () => {
			expect(() => translate(JSON.parse('{"__proto__": {"polluted": 1}, "a.__proto__.polluted": 1}'))).toThrow();
			expect(({} as any).polluted).toBeUndefined();
		});
	});
});
