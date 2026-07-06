'use strict';

import SqliteObservableTable from './observable.table';
import SqliteJournalPoller from '../sqlite.journal.poller';

class SqliteObservableTablesMap {
	public static init(): SqliteObservableTablesMap {
		if (!SqliteObservableTablesMap._instance) SqliteObservableTablesMap._instance = new SqliteObservableTablesMap();
		return SqliteObservableTablesMap._instance;
	}

	public static get(orm: any, entity: any, poller: SqliteJournalPoller): SqliteObservableTable {
		const instance: SqliteObservableTablesMap = SqliteObservableTablesMap.init();
		const map: Map<string, SqliteObservableTable> = instance._map;

		const meta: any = orm.getMetadata().get(entity.name);
		const tableName: string = meta.tableName;
		if (!map.get(tableName)) map.set(tableName, new SqliteObservableTable(orm, entity, poller));

		return map.get(tableName);
	}

	public static clear(): void {
		if (SqliteObservableTablesMap._instance) SqliteObservableTablesMap._instance._map.clear();
	}

	private static _instance: SqliteObservableTablesMap;

	private readonly _map: Map<string, SqliteObservableTable>;

	private constructor() {
		this._map = new Map<string, SqliteObservableTable>();
	}
}
export default SqliteObservableTablesMap;
