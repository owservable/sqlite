'use strict';

import {ReplaySubject, Subject} from 'rxjs';

import SqliteObservableTable from '../../src/functions/observable.table';

jest.mock('@mikro-orm/core', () => ({wrap: jest.fn()}));

const {wrap} = require('@mikro-orm/core');

class UserEntity {}

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('observable.table tests', () => {
	let poller: any;
	let em: any;
	let errorSpy: jest.SpyInstance;

	const createMeta = (pkType: string = 'number'): any => ({
		tableName: 'users',
		primaryKeys: ['id'],
		properties: {id: {type: pkType, fieldNames: ['id']}},
		props: [{name: 'id', fieldNames: ['id']}, {name: 'firstName', fieldNames: ['first_name']}, {name: 'virtualProp'}]
	});

	const createOrm = (meta: any): any => ({
		getMetadata: (): any => ({get: jest.fn().mockReturnValue(meta)}),
		em: {fork: jest.fn((): any => em)}
	});

	const createTable = (meta: any = createMeta()): {table: SqliteObservableTable; orm: any; emissions: any[]} => {
		const orm: any = createOrm(meta);
		const table: SqliteObservableTable = new SqliteObservableTable(orm, UserEntity, poller);
		const emissions: any[] = [];
		table.subscribe((change: any): void => {
			emissions.push(change);
		});
		return {table, orm, emissions};
	};

	beforeEach(() => {
		poller = {notifications: new Subject<any>(), lifecycle: new ReplaySubject<any>(1)};
		em = {findOne: jest.fn()};
		errorSpy = jest.spyOn(console, 'error').mockImplementation((): undefined => undefined);
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('should expose tableName and pkProperty', () => {
		const {table} = createTable();
		expect(table.tableName).toBe('users');
		expect(table.pkProperty).toBe('id');
	});

	it('should coerce the primary key to a number for numeric pk types', () => {
		const {table} = createTable();
		expect(table.coercePrimaryKey('5')).toBe(5);
	});

	it('should keep the primary key as a string for non-numeric pk types', () => {
		const {table} = createTable(createMeta('string'));
		expect(table.coercePrimaryKey('abc')).toBe('abc');
	});

	it('should treat a missing pk property definition as non-numeric', () => {
		const meta: any = createMeta();
		meta.properties = {};
		const {table} = createTable(meta);
		expect(table.coercePrimaryKey('7')).toBe('7');
	});

	it('should emit delete notifications without fetching the entity', async () => {
		const {orm, emissions} = createTable();

		poller.notifications.next({table: 'users', op: 'delete', id: '3'});
		await flush();

		expect(emissions).toEqual([{ns: {coll: 'users'}, documentKey: {_id: '3'}, operationType: 'delete'}]);
		expect(orm.em.fork).not.toHaveBeenCalled();
	});

	it('should fetch and emit the full document on insert with a coerced numeric pk', async () => {
		const {emissions} = createTable();
		em.findOne.mockResolvedValue({id: 4});
		wrap.mockReturnValue({toObject: (): any => ({id: 4, firstName: 'Ana'})});

		poller.notifications.next({table: 'users', op: 'insert', id: '4'});
		await flush();

		expect(em.findOne).toHaveBeenCalledWith(UserEntity, {id: 4});
		expect(emissions).toEqual([
			{
				ns: {coll: 'users'},
				documentKey: {_id: '4'},
				operationType: 'insert',
				updateDescription: undefined,
				fullDocument: {id: 4, firstName: 'Ana'}
			}
		]);
	});

	it('should fetch using the raw string id when the pk is not numeric', async () => {
		const {emissions} = createTable(createMeta('uuid'));
		em.findOne.mockResolvedValue({id: 'abc'});
		wrap.mockReturnValue({toObject: (): any => ({id: 'abc'})});

		poller.notifications.next({table: 'users', op: 'insert', id: 'abc'});
		await flush();

		expect(em.findOne).toHaveBeenCalledWith(UserEntity, {id: 'abc'});
		expect(emissions[0].fullDocument).toEqual({id: 'abc'});
	});

	it('should emit without a full document when the entity is not found', async () => {
		const {emissions} = createTable();
		em.findOne.mockResolvedValue(null);

		poller.notifications.next({table: 'users', op: 'update', id: '9'});
		await flush();

		expect(emissions).toEqual([{ns: {coll: 'users'}, documentKey: {_id: '9'}, operationType: 'update'}]);
	});

	it('should map changed columns to properties in the update description', async () => {
		const {emissions} = createTable();
		em.findOne.mockResolvedValue({id: 4});
		wrap.mockReturnValue({toObject: (): any => ({id: 4, firstName: 'Ana'})});

		poller.notifications.next({table: 'users', op: 'update', id: '4', changed: ['first_name', 'unknown_col']});
		await flush();

		expect(emissions).toEqual([
			{
				ns: {coll: 'users'},
				documentKey: {_id: '4'},
				operationType: 'update',
				updateDescription: {updatedFields: {firstName: 'Ana', unknown_col: true}, removedFields: []},
				fullDocument: {id: 4, firstName: 'Ana'}
			}
		]);
	});

	it('should build an empty update description when no changed columns are provided', async () => {
		const {emissions} = createTable();
		em.findOne.mockResolvedValue({id: 4});
		wrap.mockReturnValue({toObject: (): any => ({id: 4})});

		poller.notifications.next({table: 'users', op: 'update', id: '4', changed: null});
		await flush();

		expect(emissions[0].updateDescription).toEqual({updatedFields: {}, removedFields: []});
	});

	it('should ignore notifications for other tables and empty notifications', async () => {
		const {orm, emissions} = createTable();

		poller.notifications.next(undefined);
		poller.notifications.next({table: 'other', op: 'insert', id: '1'});
		await flush();

		expect(emissions).toEqual([]);
		expect(orm.em.fork).not.toHaveBeenCalled();
	});

	it('should emit an empty change on live lifecycle events after the first one', () => {
		const {emissions} = createTable();

		poller.lifecycle.next(undefined);
		poller.lifecycle.next({type: 'close'});
		poller.lifecycle.next({type: 'live'});
		expect(emissions).toEqual([]);

		poller.lifecycle.next({type: 'live'});
		expect(emissions).toEqual([{}]);
	});

	it('should log processing errors', async () => {
		const {emissions} = createTable();
		em.findOne.mockRejectedValue(new Error('db down'));

		poller.notifications.next({table: 'users', op: 'insert', id: '1'});
		await flush();

		expect(emissions).toEqual([]);
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining('SqliteObservableTable[users] Error processing notification'),
			expect.objectContaining({error: expect.any(Error)})
		);
	});
});
