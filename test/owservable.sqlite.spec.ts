'use strict';

import OwservableSqlite, {
	SqliteBackend,
	SqliteConnector,
	SqliteJournalPoller,
	SqliteTablesEntitiesMap,
	SqliteLiveUpdates,
	SqliteLiveUpdatesRegistry,
	SqliteObservableTable,
	SqliteObservableTablesMap,
	installSqliteTriggers,
	processSqliteEntities
} from '../src/owservable.sqlite';

import SqliteBackendDirect from '../src/sqlite.backend';
import SqliteConnectorDirect from '../src/sqlite.connector';
import SqliteJournalPollerDirect from '../src/sqlite.journal.poller';
import TablesEntitiesMapDirect from '../src/tables.entities.map';
import LiveUpdatesDirect, {SqliteLiveUpdatesRegistry as LiveUpdatesRegistryDirect} from '../src/decorators/live.updates';
import ObservableTableDirect from '../src/functions/observable.table';
import ObservableTablesMapDirect from '../src/functions/observable.tables.map';
import installTriggersDirect from '../src/functions/install.triggers';
import processEntitiesDirect from '../src/functions/process.entities';

jest.mock('@mikro-orm/core', () => ({wrap: jest.fn()}));
jest.mock('@mikro-orm/sqlite', () => ({MikroORM: {init: jest.fn()}}));
jest.mock('@owservable/core', () => ({
	BackendRegistry: jest.requireActual('@owservable/core/lib/backend/backend.registry').default
}));

describe('owservable.sqlite tests', () => {
	it('should re-export all modules', () => {
		expect(SqliteBackend).toBe(SqliteBackendDirect);
		expect(SqliteConnector).toBe(SqliteConnectorDirect);
		expect(SqliteJournalPoller).toBe(SqliteJournalPollerDirect);
		expect(SqliteTablesEntitiesMap).toBe(TablesEntitiesMapDirect);
		expect(SqliteLiveUpdates).toBe(LiveUpdatesDirect);
		expect(SqliteLiveUpdatesRegistry).toBe(LiveUpdatesRegistryDirect);
		expect(SqliteObservableTable).toBe(ObservableTableDirect);
		expect(SqliteObservableTablesMap).toBe(ObservableTablesMapDirect);
		expect(installSqliteTriggers).toBe(installTriggersDirect);
		expect(processSqliteEntities).toBe(processEntitiesDirect);
	});

	it('should export an empty default object', () => {
		expect(OwservableSqlite).toEqual({});
	});
});
