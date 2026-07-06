'use strict';

export default class SqliteTablesEntitiesMap {
	public static addTableToEntityMapping(tableName: string, entity: any): void {
		SqliteTablesEntitiesMap._entities.set(tableName, entity);
	}

	public static getEntityByTable(tableName: string): any | null {
		return SqliteTablesEntitiesMap._entities.get(tableName) ?? null;
	}

	public static keys(): string[] {
		return Array.from(SqliteTablesEntitiesMap._entities.keys());
	}

	public static values(): any[] {
		return Array.from(SqliteTablesEntitiesMap._entities.values());
	}

	public static clear(): void {
		SqliteTablesEntitiesMap._entities.clear();
	}

	private static readonly _entities: Map<string, any> = new Map<string, any>();

	private constructor() {}
}
