'use strict';

import installSqliteTriggers from '../../src/functions/install.triggers';

class UserEntity {}
class NoteEntity {}
class TagEntity {}

describe('install.triggers tests', () => {
	let execute: jest.Mock;
	let orm: any;
	let logSpy: jest.SpyInstance;

	const metas: any = {
		UserEntity: {
			tableName: 'users',
			primaryKeys: ['id'],
			properties: {id: {fieldNames: ['user_id']}},
			props: [
				{name: 'id', kind: 'scalar', fieldNames: ['user_id']},
				{name: 'firstName', kind: 'scalar', fieldNames: ['first_name']},
				{name: 'notes', kind: '1:m', fieldNames: ['notes_field']}
			]
		},
		NoteEntity: {tableName: 'notes', primaryKeys: ['noteId'], properties: {noteId: {}}},
		TagEntity: {tableName: 'tags', primaryKeys: ['tagId'], properties: {}, props: [{name: 'tagId'}]}
	};

	const executedSqls = (): string[] => execute.mock.calls.map((call: any[]): string => call[0]);

	beforeEach(() => {
		execute = jest.fn().mockResolvedValue(undefined);
		orm = {
			em: {getConnection: (): any => ({execute})},
			getMetadata: (): any => ({get: (name: string): any => metas[name]})
		};
		logSpy = jest.spyOn(console, 'log').mockImplementation((): undefined => undefined);
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('should create the journal table and index when no entities are given', async () => {
		await installSqliteTriggers(orm, []);

		expect(execute).toHaveBeenCalledTimes(2);
		const sqls: string[] = executedSqls();
		expect(sqls[0]).toContain('CREATE TABLE IF NOT EXISTS "_owservable_changes"');
		expect(sqls[0]).toContain('id INTEGER PRIMARY KEY AUTOINCREMENT');
		expect(sqls[1]).toBe('CREATE INDEX IF NOT EXISTS "_owservable_changes_id_idx" ON "_owservable_changes" (id)');
		expect(logSpy).not.toHaveBeenCalled();
	});

	it('should install insert, update and delete triggers using the pk column field name', async () => {
		await installSqliteTriggers(orm, [UserEntity]);

		expect(execute).toHaveBeenCalledTimes(8);
		const sqls: string[] = executedSqls();
		expect(sqls[2]).toBe('DROP TRIGGER IF EXISTS "users_owservable_ins"');
		expect(sqls[3]).toContain('CREATE TRIGGER "users_owservable_ins" AFTER INSERT ON "users"');
		expect(sqls[3]).toContain(`VALUES ('users', 'insert', NEW."user_id", NULL)`);
		expect(sqls[4]).toBe('DROP TRIGGER IF EXISTS "users_owservable_upd"');
		expect(sqls[5]).toContain('CREATE TRIGGER "users_owservable_upd" AFTER UPDATE ON "users"');
		expect(sqls[5]).toContain(
			`RTRIM(CASE WHEN OLD."user_id" IS NOT NEW."user_id" THEN 'user_id,' ELSE '' END || CASE WHEN OLD."first_name" IS NOT NEW."first_name" THEN 'first_name,' ELSE '' END, ',')`
		);
		expect(sqls[5]).not.toContain('notes_field');
		expect(sqls[6]).toBe('DROP TRIGGER IF EXISTS "users_owservable_del"');
		expect(sqls[7]).toContain('CREATE TRIGGER "users_owservable_del" AFTER DELETE ON "users"');
		expect(sqls[7]).toContain(`VALUES ('users', 'delete', OLD."user_id", NULL)`);
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('live updates enabled for table "users"'));
	});

	it('should fall back to the pk property when fieldNames and props are missing', async () => {
		await installSqliteTriggers(orm, [NoteEntity]);

		const sqls: string[] = executedSqls();
		expect(sqls[3]).toContain('"notes_owservable_ins"');
		expect(sqls[3]).toContain('NEW."noteId"');
		expect(sqls[5]).toContain(`'update', NEW."noteId", RTRIM(, ',')`);
		expect(sqls[7]).toContain('OLD."noteId"');
	});

	it('should fall back to the pk property when the pk property metadata is missing', async () => {
		await installSqliteTriggers(orm, [TagEntity]);

		const sqls: string[] = executedSqls();
		expect(sqls[3]).toContain('"tags_owservable_ins"');
		expect(sqls[3]).toContain('NEW."tagId"');
		expect(sqls[5]).toContain(`'update', NEW."tagId", RTRIM(, ',')`);
	});

	it('should install triggers for multiple entities', async () => {
		await installSqliteTriggers(orm, [UserEntity, NoteEntity, TagEntity]);

		expect(execute).toHaveBeenCalledTimes(20);
		const sqls: string[] = executedSqls();
		expect(sqls.some((sql: string): boolean => sql.includes('AFTER INSERT ON "users"'))).toBe(true);
		expect(sqls.some((sql: string): boolean => sql.includes('AFTER INSERT ON "notes"'))).toBe(true);
		expect(sqls.some((sql: string): boolean => sql.includes('AFTER INSERT ON "tags"'))).toBe(true);
		expect(logSpy).toHaveBeenCalledTimes(3);
	});
});
