'use strict';

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import assert from 'node:assert/strict';

import {defineEntity} from '@mikro-orm/sqlite';

import {BackendRegistry} from '@owservable/core';

import SqliteConnector from '../../src/sqlite.connector';
import SqliteJournalPoller from '../../src/sqlite.journal.poller';
import SqliteTablesEntitiesMap from '../../src/tables.entities.map';
import installSqliteTriggers from '../../src/functions/install.triggers';
import {SqliteLiveUpdatesRegistry} from '../../src/decorators/live.updates';

const BetterSqlite3 = require('better-sqlite3');

const DB_FILE: string = path.join(os.tmpdir(), `owservable-sqlite-integration-${process.pid}.db`);
const TABLE: string = 'sq_integration';
const POLL_MS: number = 100;

const SqIntegration = defineEntity({
	name: 'SqIntegration',
	tableName: TABLE,
	properties: (p: any) => ({
		id: p.integer().primary().autoincrement(),
		name: p.string(),
		amount: p.integer().nullable(),
		createdAt: p.datetime().onCreate((): Date => new Date()),
		updatedAt: p
			.datetime()
			.onCreate((): Date => new Date())
			.onUpdate((): Date => new Date())
	})
});
SqliteLiveUpdatesRegistry.add(SqIntegration);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const waitFor = async (predicate: () => boolean, what: string, timeoutMs: number = 5000): Promise<void> => {
	const start: number = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for: ${what}`);
		await sleep(25);
	}
};

const cleanupFiles = (): void => {
	for (const suffix of ['', '-wal', '-shm']) {
		try {
			fs.unlinkSync(DB_FILE + suffix);
		} catch (ignore) {
			// file absent
		}
	}
};

const run = async (): Promise<void> => {
	console.log('[integration] 1. SqliteConnector.init (MikroORM init, WAL, schema sync, journal triggers, poller, registry)');
	const orm: any = await SqliteConnector.init({entities: [SqIntegration], dbName: DB_FILE, pollIntervalMs: POLL_MS});

	assert.equal(BackendRegistry.has(TABLE), true, 'backend registered');
	assert.equal(SqliteTablesEntitiesMap.getEntityByTable(TABLE), SqIntegration, 'entity mapped');
	assert.equal(orm.getMetadata().get(SqIntegration.name).tableName, TABLE, 'metadata resolves by entity.name');

	const notifications: any[] = [];
	SqliteJournalPoller.instance.notifications.subscribe((n: any) => notifications.push(n));

	const backend: any = BackendRegistry.get(TABLE);
	const changes: any[] = [];
	backend.changes().subscribe((c: any) => changes.push(c));

	console.log('[integration] 2. ORM INSERT -> journal -> notification + normalized change event');
	const em: any = orm.em.fork();
	const row: any = em.create(SqIntegration, {name: 'row-one', amount: 1});
	await em.persist(row).flush();

	await waitFor(() => notifications.some((n) => 'insert' === n.op), 'insert notification');
	const insertNotification: any = notifications.find((n) => 'insert' === n.op);
	assert.equal(insertNotification.table, TABLE, 'insert notification table');
	assert.equal(String(insertNotification.id), String(row.id), 'insert notification pk');

	await waitFor(() => changes.some((c) => 'insert' === c.operationType), 'normalized insert event');
	const insertChange: any = changes.find((c) => 'insert' === c.operationType);
	assert.equal(String(insertChange.documentKey._id), String(row.id), 'insert documentKey._id');
	assert.equal(insertChange.fullDocument.name, 'row-one', 'insert fullDocument enriched via PK refetch');

	console.log('[integration] 3. ORM UPDATE -> changed columns mapped to camelCase properties');
	row.name = 'row-one-renamed';
	await em.flush();

	await waitFor(() => changes.some((c) => 'update' === c.operationType), 'normalized update event');
	const updateNotification: any = notifications.find((n) => 'update' === n.op);
	assert.ok(updateNotification.changed.includes('name'), 'update changed contains name column');
	assert.ok(updateNotification.changed.includes('updated_at'), 'update changed contains updated_at column');

	const updateChange: any = changes.find((c) => 'update' === c.operationType);
	const updatedFieldKeys: string[] = Object.keys(updateChange.updateDescription.updatedFields);
	assert.ok(updatedFieldKeys.includes('name'), 'updatedFields has property name');
	assert.ok(updatedFieldKeys.includes('updatedAt'), 'updatedFields maps updated_at -> updatedAt');

	console.log('[integration] 4. EXTERNAL raw connection INSERT + UPDATE (the mastra scenario)');
	const external: any = new BetterSqlite3(DB_FILE);
	external.pragma('journal_mode = WAL');
	external.prepare(`INSERT INTO "sq_integration" (name, amount, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))`).run('external-row', 7);
	const externalId: number = Number(external.prepare('SELECT last_insert_rowid() AS id').get().id);

	await waitFor(() => changes.some((c) => 'insert' === c.operationType && String(c.documentKey._id) === String(externalId)), 'external insert change event');
	const externalInsert: any = changes.find((c) => 'insert' === c.operationType && String(c.documentKey._id) === String(externalId));
	assert.equal(externalInsert.fullDocument.name, 'external-row', 'external insert enriched');

	external.prepare(`UPDATE "sq_integration" SET amount = ? WHERE id = ?`).run(9, externalId);
	await waitFor(() => changes.some((c) => 'update' === c.operationType && String(c.documentKey._id) === String(externalId)), 'external update change event');
	const externalUpdate: any = changes.find((c) => 'update' === c.operationType && String(c.documentKey._id) === String(externalId));
	assert.ok(Object.keys(externalUpdate.updateDescription.updatedFields).includes('amount'), 'external update changed columns');
	assert.equal(externalUpdate.fullDocument.amount, 9, 'external update fullDocument fresh');
	external.close();

	console.log('[integration] 5. Backend queries (find/count/findById with Mongo-style operators)');
	const found: any[] = await backend.find({amount: {$gte: 5}}, {}, {}, {id: 1}, []);
	assert.equal(found.length, 1, '$gte filter');
	assert.equal(found[0].name, 'external-row', 'find returns plain objects');

	assert.equal(await backend.count({}), 2, 'count');

	const byId: any = await backend.findById(String(row.id), {}, []);
	assert.equal(byId.name, 'row-one-renamed', 'findById coerces text pk');

	console.log('[integration] 6. ORM DELETE -> notification without refetch');
	await em.remove(row).flush();

	await waitFor(() => changes.some((c) => 'delete' === c.operationType), 'normalized delete event');
	const deleteChange: any = changes.find((c) => 'delete' === c.operationType);
	assert.equal(String(deleteChange.documentKey._id), String(insertChange.documentKey._id), 'delete documentKey');
	assert.equal(deleteChange.fullDocument, undefined, 'delete has no fullDocument');

	console.log('[integration] 7. Trigger bootstrap is idempotent (drop-and-recreate, second run)');
	await installSqliteTriggers(orm, [SqIntegration]);

	console.log('[integration] 8. Cleanup');
	await SqliteConnector.close();
};

const main = async (): Promise<void> => {
	console.log(`[integration] target: temp file ${DB_FILE}`);
	cleanupFiles();

	try {
		await run();
		console.log('[integration] PASS: init, WAL, schema sync, journal triggers, poller, external-writer capture, enrichment, queries, delete, idempotency');
	} finally {
		cleanupFiles();
	}
};

main()
	.then((): void => process.exit(0))
	.catch((error: any): void => {
		console.error('[integration] FAIL:', error);
		process.exit(1);
	});
