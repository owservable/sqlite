'use strict';

import {ReplaySubject, Subject} from 'rxjs';

import SqliteObservableTable from '../../src/functions/observable.table';
import SqliteObservableTablesMap from '../../src/functions/observable.tables.map';

class UserEntity {}
class NoteEntity {}

describe('observable.tables.map tests', () => {
	const metas: any = {
		UserEntity: {tableName: 'users', primaryKeys: ['id'], properties: {id: {type: 'number'}}, props: [{name: 'id', fieldNames: ['id']}]},
		NoteEntity: {tableName: 'notes', primaryKeys: ['id'], properties: {id: {type: 'number'}}, props: [{name: 'id', fieldNames: ['id']}]}
	};

	const createOrm = (): any => ({
		getMetadata: (): any => ({get: (name: string): any => metas[name]}),
		em: {fork: jest.fn()}
	});

	const createPoller = (): any => ({
		notifications: new Subject<any>(),
		lifecycle: new ReplaySubject<any>(1)
	});

	it('should tolerate clear before initialization', () => {
		expect(() => SqliteObservableTablesMap.clear()).not.toThrow();
	});

	it('should return the same singleton from init', () => {
		expect(SqliteObservableTablesMap.init()).toBe(SqliteObservableTablesMap.init());
	});

	it('should create one observable table per table name', () => {
		SqliteObservableTablesMap.clear();
		const orm: any = createOrm();
		const poller: any = createPoller();

		const users: SqliteObservableTable = SqliteObservableTablesMap.get(orm, UserEntity, poller);
		const notes: SqliteObservableTable = SqliteObservableTablesMap.get(orm, NoteEntity, poller);

		expect(users).toBeInstanceOf(SqliteObservableTable);
		expect(users.tableName).toBe('users');
		expect(notes.tableName).toBe('notes');
		expect(users).not.toBe(notes);
		expect(SqliteObservableTablesMap.get(orm, UserEntity, poller)).toBe(users);
	});

	it('should create a fresh observable table after clear', () => {
		SqliteObservableTablesMap.clear();
		const orm: any = createOrm();
		const poller: any = createPoller();

		const before: SqliteObservableTable = SqliteObservableTablesMap.get(orm, UserEntity, poller);
		SqliteObservableTablesMap.clear();
		const after: SqliteObservableTable = SqliteObservableTablesMap.get(orm, UserEntity, poller);

		expect(after).toBeInstanceOf(SqliteObservableTable);
		expect(after).not.toBe(before);
	});
});
