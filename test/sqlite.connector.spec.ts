'use strict';

import {MikroORM} from '@mikro-orm/sqlite';
import {BackendRegistry} from '@owservable/core';

import SqliteConnector from '../src/sqlite.connector';
import SqliteJournalPoller from '../src/sqlite.journal.poller';
import SqliteBackend from '../src/sqlite.backend';
import SqliteTablesEntitiesMap from '../src/tables.entities.map';
import SqliteObservableTablesMap from '../src/functions/observable.tables.map';
import {SqliteLiveUpdatesRegistry} from '../src/decorators/live.updates';

jest.mock('@mikro-orm/core', () => ({wrap: jest.fn()}));
jest.mock('@mikro-orm/sqlite', () => ({MikroORM: {init: jest.fn()}}));
jest.mock('@owservable/core', () => ({
	BackendRegistry: jest.requireActual('@owservable/core/lib/backend/backend.registry').default
}));

const InitMock: jest.Mock = MikroORM.init as unknown as jest.Mock;

const FAKE_TIMER_OPTIONS: any = {doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'clearImmediate']};

class UserEntity {}
class NoteEntity {}

describe('sqlite.connector tests', () => {
	let execute: jest.Mock;
	let mockOrm: any;
	let logSpy: jest.SpyInstance;

	const metas: any = {
		UserEntity: {
			tableName: 'users',
			primaryKeys: ['id'],
			properties: {id: {type: 'number', fieldNames: ['id']}},
			props: [{name: 'id', kind: 'scalar', fieldNames: ['id']}]
		},
		NoteEntity: {
			tableName: 'notes',
			primaryKeys: ['id'],
			properties: {id: {type: 'number', fieldNames: ['id']}},
			props: [{name: 'id', kind: 'scalar', fieldNames: ['id']}]
		}
	};

	const baseOptions = (): any => ({entities: [UserEntity, NoteEntity], dbName: 'test.sqlite'});

	const executedSqls = (): string[] => execute.mock.calls.map((call: any[]): string => call[0]);

	beforeEach(() => {
		jest.useFakeTimers(FAKE_TIMER_OPTIONS);
		execute = jest.fn().mockResolvedValue([]);
		mockOrm = {
			schema: {update: jest.fn().mockResolvedValue(undefined)},
			getMetadata: (): any => ({get: (name: string): any => metas[name]}),
			em: {fork: jest.fn((): any => 'forked-em'), getConnection: (): any => ({execute})},
			close: jest.fn().mockResolvedValue(undefined)
		};
		InitMock.mockResolvedValue(mockOrm);
		BackendRegistry.clear();
		SqliteLiveUpdatesRegistry.clear();
		SqliteTablesEntitiesMap.clear();
		SqliteObservableTablesMap.clear();
		logSpy = jest.spyOn(console, 'log').mockImplementation((): undefined => undefined);
		jest.spyOn(console, 'warn').mockImplementation((): undefined => undefined);
		jest.spyOn(console, 'error').mockImplementation((): undefined => undefined);
	});

	afterEach(async () => {
		await SqliteConnector.close();
		jest.useRealTimers();
		jest.restoreAllMocks();
	});

	it('should be instantiable only through its static API', () => {
		expect(new (SqliteConnector as any)()).toBeInstanceOf(SqliteConnector);
	});

	it('should return undefined from orm and em before init', () => {
		expect(SqliteConnector.orm).toBeUndefined();
		expect(SqliteConnector.em()).toBeUndefined();
	});

	it('should initialize the orm, configure pragmas, install triggers and register backends', async () => {
		SqliteLiveUpdatesRegistry.add(UserEntity);

		const orm: any = await SqliteConnector.init(baseOptions());

		expect(orm).toBe(mockOrm);
		expect(InitMock).toHaveBeenCalledWith({entities: [UserEntity, NoteEntity], dbName: 'test.sqlite'});

		const sqls: string[] = executedSqls();
		expect(sqls[0]).toBe('PRAGMA journal_mode = WAL');
		expect(sqls[1]).toBe('PRAGMA busy_timeout = 5000');
		expect(logSpy).toHaveBeenCalledWith('[@owservable/sqlite] -> SQLite connected to test.sqlite (WAL)');

		expect(mockOrm.schema.update).toHaveBeenCalledWith({safe: true});
		expect(logSpy).toHaveBeenCalledWith('[@owservable/sqlite] -> SQLite schema synchronized', '(safe mode)');

		expect(sqls).toHaveLength(10);
		expect(sqls[2]).toContain('CREATE TABLE IF NOT EXISTS "_owservable_changes"');
		expect(sqls[3]).toContain('CREATE INDEX IF NOT EXISTS "_owservable_changes_id_idx"');
		expect(sqls.some((sql: string): boolean => sql.includes('"users_owservable_ins"'))).toBe(true);
		expect(sqls.some((sql: string): boolean => sql.includes('"notes_owservable_ins"'))).toBe(false);

		expect(SqliteJournalPoller.instance).toBeDefined();
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('polling "_owservable_changes" every 250ms'));

		expect(BackendRegistry.get('users')).toBeInstanceOf(SqliteBackend);
		expect(BackendRegistry.get('notes')).toBeInstanceOf(SqliteBackend);
		expect((BackendRegistry.get('users') as SqliteBackend).entity).toBe(UserEntity);
		expect(SqliteTablesEntitiesMap.getEntityByTable('users')).toBe(UserEntity);
		expect(SqliteTablesEntitiesMap.getEntityByTable('notes')).toBe(NoteEntity);

		expect(SqliteConnector.orm).toBe(mockOrm);
		expect(SqliteConnector.em()).toBe('forked-em');
	});

	it('should return the existing orm on subsequent init calls', async () => {
		const orm: any = await SqliteConnector.init(baseOptions());
		InitMock.mockClear();

		const again: any = await SqliteConnector.init(baseOptions());

		expect(again).toBe(orm);
		expect(InitMock).not.toHaveBeenCalled();
	});

	it('should honor custom poll interval, unsafe schema sync and orm options', async () => {
		SqliteLiveUpdatesRegistry.add(NoteEntity);

		await SqliteConnector.init({
			...baseOptions(),
			pollIntervalMs: 500,
			updateSchema: true,
			safe: false,
			triggers: true,
			ormOptions: {pool: {min: 1}}
		});

		expect(InitMock).toHaveBeenCalledWith(expect.objectContaining({pool: {min: 1}}));
		expect(mockOrm.schema.update).toHaveBeenCalledWith({safe: false});
		expect(logSpy).toHaveBeenCalledWith('[@owservable/sqlite] -> SQLite schema synchronized', '');

		const sqls: string[] = executedSqls();
		expect(sqls.some((sql: string): boolean => sql.includes('"notes_owservable_upd"'))).toBe(true);
		expect(sqls.some((sql: string): boolean => sql.includes('"users_owservable_upd"'))).toBe(false);
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('polling "_owservable_changes" every 500ms'));
	});

	it('should skip schema sync but still install triggers when updateSchema is false', async () => {
		SqliteLiveUpdatesRegistry.add(UserEntity);

		await SqliteConnector.init({...baseOptions(), updateSchema: false});

		expect(mockOrm.schema.update).not.toHaveBeenCalled();
		expect(executedSqls().some((sql: string): boolean => sql.includes('"users_owservable_ins"'))).toBe(true);
	});

	it('should sync the schema but skip triggers when triggers is false', async () => {
		SqliteLiveUpdatesRegistry.add(UserEntity);

		await SqliteConnector.init({...baseOptions(), triggers: false});

		expect(mockOrm.schema.update).toHaveBeenCalledWith({safe: true});
		expect(executedSqls()).toEqual(['PRAGMA journal_mode = WAL', 'PRAGMA busy_timeout = 5000']);
	});

	it('should stop the poller and close the orm on close', async () => {
		await SqliteConnector.init(baseOptions());
		expect(SqliteJournalPoller.instance).toBeDefined();

		await SqliteConnector.close();

		expect(SqliteJournalPoller.instance).toBeNull();
		expect(mockOrm.close).toHaveBeenCalledTimes(1);
		expect(mockOrm.close).toHaveBeenCalledWith(true);
		expect(SqliteConnector.orm).toBeNull();
		expect(SqliteConnector.em()).toBeUndefined();

		await expect(SqliteConnector.close()).resolves.toBeUndefined();
		expect(mockOrm.close).toHaveBeenCalledTimes(1);
	});
});
