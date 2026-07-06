'use strict';

import SqliteTablesEntitiesMap from '../src/tables.entities.map';

class UserEntity {}
class NoteEntity {}

describe('tables.entities.map tests', () => {
	beforeEach(() => {
		SqliteTablesEntitiesMap.clear();
	});

	it('should add and retrieve entities by table name', () => {
		SqliteTablesEntitiesMap.addTableToEntityMapping('users', UserEntity);
		SqliteTablesEntitiesMap.addTableToEntityMapping('notes', NoteEntity);
		expect(SqliteTablesEntitiesMap.getEntityByTable('users')).toBe(UserEntity);
		expect(SqliteTablesEntitiesMap.getEntityByTable('notes')).toBe(NoteEntity);
	});

	it('should return null for missing table names', () => {
		expect(SqliteTablesEntitiesMap.getEntityByTable('missing')).toBeNull();
	});

	it('should list keys and values', () => {
		SqliteTablesEntitiesMap.addTableToEntityMapping('users', UserEntity);
		SqliteTablesEntitiesMap.addTableToEntityMapping('notes', NoteEntity);
		expect(SqliteTablesEntitiesMap.keys()).toEqual(['users', 'notes']);
		expect(SqliteTablesEntitiesMap.values()).toEqual([UserEntity, NoteEntity]);
	});

	it('should overwrite an existing mapping', () => {
		SqliteTablesEntitiesMap.addTableToEntityMapping('users', UserEntity);
		SqliteTablesEntitiesMap.addTableToEntityMapping('users', NoteEntity);
		expect(SqliteTablesEntitiesMap.getEntityByTable('users')).toBe(NoteEntity);
		expect(SqliteTablesEntitiesMap.keys()).toEqual(['users']);
	});

	it('should be instantiable only through its static API', () => {
		expect(new (SqliteTablesEntitiesMap as any)()).toBeInstanceOf(SqliteTablesEntitiesMap);
	});

	it('should clear all mappings', () => {
		SqliteTablesEntitiesMap.addTableToEntityMapping('users', UserEntity);
		SqliteTablesEntitiesMap.clear();
		expect(SqliteTablesEntitiesMap.keys()).toEqual([]);
		expect(SqliteTablesEntitiesMap.values()).toEqual([]);
		expect(SqliteTablesEntitiesMap.getEntityByTable('users')).toBeNull();
	});
});
