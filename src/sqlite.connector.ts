'use strict';

import {MikroORM} from '@mikro-orm/sqlite';

import {BackendRegistry} from '@owservable/core';

import SqliteBackend from './sqlite.backend';
import SqliteJournalPoller from './sqlite.journal.poller';
import SqliteTablesEntitiesMap from './tables.entities.map';
import installSqliteTriggers from './functions/install.triggers';
import {SqliteLiveUpdatesRegistry} from './decorators/live.updates';

export type SqliteConnectorOptionsType = {
	entities: any[];
	dbName: string;
	pollIntervalMs?: number;
	updateSchema?: boolean;
	safe?: boolean;
	triggers?: boolean;
	ormOptions?: any;
};

export default class SqliteConnector {
	public static async init(options: SqliteConnectorOptionsType): Promise<any> {
		if (SqliteConnector._orm) return SqliteConnector._orm;

		const {entities, dbName, pollIntervalMs = 250, updateSchema = true, safe = true, triggers = true, ormOptions = {}} = options;

		const orm: any = await MikroORM.init({
			entities,
			dbName,
			...ormOptions
		});

		const connection: any = orm.em.getConnection();
		await connection.execute('PRAGMA journal_mode = WAL');
		await connection.execute('PRAGMA busy_timeout = 5000');
		console.log(`[@owservable/sqlite] -> SQLite connected to ${dbName} (WAL)`);

		if (updateSchema) {
			await orm.schema.update({safe});
			console.log('[@owservable/sqlite] -> SQLite schema synchronized', safe ? '(safe mode)' : '');
		}

		if (triggers) {
			const liveEntities: any[] = entities.filter((entity: any): boolean => SqliteLiveUpdatesRegistry.has(entity));
			await installSqliteTriggers(orm, liveEntities);
		}

		const poller: SqliteJournalPoller = SqliteJournalPoller.init(orm, pollIntervalMs);

		for (const entity of entities) {
			const meta: any = orm.getMetadata().get(entity.name);
			const tableName: string = meta.tableName;

			SqliteTablesEntitiesMap.addTableToEntityMapping(tableName, entity);
			BackendRegistry.register(tableName, new SqliteBackend(orm, entity, poller));
		}

		SqliteConnector._orm = orm;
		return orm;
	}

	public static get orm(): any {
		return SqliteConnector._orm;
	}

	public static em(): any {
		return SqliteConnector._orm?.em.fork();
	}

	public static async close(): Promise<void> {
		SqliteJournalPoller.stop();
		if (SqliteConnector._orm) {
			await SqliteConnector._orm.close(true);
			SqliteConnector._orm = null;
		}
	}

	private static _orm: any;

	private constructor() {}
}
