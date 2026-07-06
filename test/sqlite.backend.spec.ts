'use strict';

import {ReplaySubject, Subject} from 'rxjs';

import {wrap} from '@mikro-orm/core';

import SqliteBackend from '../src/sqlite.backend';
import SqliteObservableTable from '../src/functions/observable.table';
import SqliteObservableTablesMap from '../src/functions/observable.tables.map';

jest.mock('@mikro-orm/core', () => ({wrap: jest.fn()}));

class UserEntity {}

describe('sqlite.backend tests', () => {
	let em: any;
	let orm: any;
	let poller: any;
	let backend: SqliteBackend;

	const meta: any = {
		tableName: 'users',
		primaryKeys: ['id'],
		properties: {id: {type: 'number', fieldNames: ['id']}},
		props: [{name: 'id', fieldNames: ['id']}]
	};

	beforeEach(() => {
		SqliteObservableTablesMap.clear();
		em = {find: jest.fn(), findOne: jest.fn(), count: jest.fn()};
		orm = {getMetadata: (): any => ({get: (): any => meta}), em: {fork: jest.fn((): any => em)}};
		poller = {notifications: new Subject<any>(), lifecycle: new ReplaySubject<any>(1)};
		backend = new SqliteBackend(orm, UserEntity, poller);
		(wrap as any).mockImplementation((entity: any): any => ({toObject: (): any => ({...entity, mapped: true})}));
	});

	it('should expose the target table and entity', () => {
		expect(backend.target()).toBe('users');
		expect(backend.entity).toBe(UserEntity);
	});

	it('should return the same observable table from changes', () => {
		const changes: any = backend.changes();
		expect(changes).toBeInstanceOf(SqliteObservableTable);
		expect(backend.changes()).toBe(changes);
	});

	it('should find entities translating query, fields, paging, sort and populates', async () => {
		em.find.mockResolvedValue([{id: 1}, {id: 2}]);

		const result: any[] = await backend.find(
			{_id: 7, name: 'x', $and: [{_id: '3'}, 'raw'], $or: {y: 1}, $nor: [{z: 2}]},
			{name: 1, secret: 0},
			{skip: 5, limit: 10},
			{a: 1, b: -1, c: 'desc', d: 'asc'},
			['rel', {path: 'other'}, {foo: 1}, null]
		);

		expect(em.find).toHaveBeenCalledWith(
			UserEntity,
			{id: 7, name: 'x', $and: [{id: '3'}, 'raw'], $or: {y: 1}, $nor: [{z: 2}]},
			{
				fields: ['name'],
				orderBy: {a: 'asc', b: 'desc', c: 'desc', d: 'asc'},
				offset: 5,
				limit: 10,
				populate: ['rel', 'other']
			}
		);
		expect(result).toEqual([
			{id: 1, mapped: true},
			{id: 2, mapped: true}
		]);
	});

	it('should find entities with empty options translated to undefined', async () => {
		em.find.mockResolvedValue([]);

		const result: any[] = await backend.find(null, {}, undefined, {}, []);

		expect(em.find).toHaveBeenCalledWith(UserEntity, null, {
			fields: undefined,
			orderBy: undefined,
			offset: undefined,
			limit: undefined,
			populate: undefined
		});
		expect(result).toEqual([]);
	});

	it('should pass field arrays through untouched', async () => {
		em.find.mockResolvedValue([]);

		await backend.find(null, ['a', 'b'], null, null, null);

		expect(em.find).toHaveBeenCalledWith(UserEntity, null, {
			fields: ['a', 'b'],
			orderBy: undefined,
			offset: undefined,
			limit: undefined,
			populate: undefined
		});
	});

	it('should translate all-excluded field projections to undefined', async () => {
		em.find.mockResolvedValue([]);

		await backend.find(null, {a: 0, b: 0}, null, null, [{foo: 1}, null]);

		expect(em.find).toHaveBeenCalledWith(UserEntity, null, {
			fields: undefined,
			orderBy: undefined,
			offset: undefined,
			limit: undefined,
			populate: undefined
		});
	});

	it('should find one entity and map it', async () => {
		em.findOne.mockResolvedValue({id: 9});

		const result: any = await backend.findOne({_id: 9}, {a: 1}, ['p']);

		expect(em.findOne).toHaveBeenCalledWith(UserEntity, {id: 9}, {fields: ['a'], populate: ['p']});
		expect(result).toEqual({id: 9, mapped: true});
	});

	it('should pass through a null findOne result', async () => {
		em.findOne.mockResolvedValue(null);

		const result: any = await backend.findOne({name: 'x'}, {}, []);

		expect(result).toBeNull();
	});

	it('should find by id with a coerced primary key', async () => {
		em.findOne.mockResolvedValue({id: 5});

		const result: any = await backend.findById('5', {}, []);

		expect(em.findOne).toHaveBeenCalledWith(UserEntity, {id: 5}, {fields: undefined, populate: undefined});
		expect(result).toEqual({id: 5, mapped: true});
	});

	it('should count entities passing string queries through', async () => {
		em.count.mockResolvedValue(3);

		const result: number = await backend.count('raw query');

		expect(em.count).toHaveBeenCalledWith(UserEntity, 'raw query');
		expect(result).toBe(3);
	});

	it('should return the document as-is from populate and toJSON', async () => {
		const document: any = {id: 1};
		await expect(backend.populate(document, 'anything')).resolves.toBe(document);
		expect(backend.toJSON(document)).toBe(document);
	});

	it('should resolve virtuals into a clone of the document', async () => {
		const document: any = {keep: 1, v1: Promise.resolve('a'), v2: 'b'};

		const result: any = await backend.resolveVirtuals(document, ['v1', 'v2']);

		expect(result).toEqual({keep: 1, v1: 'a', v2: 'b'});
		expect(result).not.toBe(document);
		expect(document.v1).toBeInstanceOf(Promise);
	});

	it('should resolve no virtuals to a plain clone', async () => {
		const document: any = {keep: 1};

		const result: any = await backend.resolveVirtuals(document, []);

		expect(result).toEqual({keep: 1});
		expect(result).not.toBe(document);
	});
});
