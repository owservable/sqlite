'use strict';

import SqliteBackend from './sqlite.backend';
import SqliteConnector, {type SqliteConnectorOptionsType} from './sqlite.connector';
import SqliteJournalPoller, {type SqliteNotificationType} from './sqlite.journal.poller';
import SqliteTablesEntitiesMap from './tables.entities.map';

import SqliteLiveUpdates, {SqliteLiveUpdatesRegistry} from './decorators/live.updates';

import SqliteObservableTable from './functions/observable.table';
import SqliteObservableTablesMap from './functions/observable.tables.map';
import installSqliteTriggers from './functions/install.triggers';
import processSqliteEntities from './functions/process.entities';

export {
	SqliteBackend, //
	SqliteConnector,
	SqliteJournalPoller,
	SqliteTablesEntitiesMap,
	SqliteLiveUpdates,
	SqliteLiveUpdatesRegistry,
	SqliteObservableTable,
	SqliteObservableTablesMap,
	installSqliteTriggers,
	processSqliteEntities
};
export type {SqliteConnectorOptionsType, SqliteNotificationType};
const OwservableSqlite = {};
export default OwservableSqlite;
