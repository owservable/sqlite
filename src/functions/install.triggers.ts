'use strict';

const JOURNAL_TABLE: string = '_owservable_changes';

const _journalTableSql = (): string[] => [
	`CREATE TABLE IF NOT EXISTS "${JOURNAL_TABLE}" (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	table_name TEXT NOT NULL,
	op TEXT NOT NULL,
	pk TEXT,
	changed TEXT,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`,
	`CREATE INDEX IF NOT EXISTS "${JOURNAL_TABLE}_id_idx" ON "${JOURNAL_TABLE}" (id)`
];

const _changedExpression = (columns: string[]): string => {
	const terms: string[] = columns.map((column: string): string => `CASE WHEN OLD."${column}" IS NOT NEW."${column}" THEN '${column},' ELSE '' END`);
	return `RTRIM(${terms.join(' || ')}, ',')`;
};

const _tableTriggersSql = (tableName: string, pkColumn: string, columns: string[]): string[] => [
	`DROP TRIGGER IF EXISTS "${tableName}_owservable_ins"`,
	`CREATE TRIGGER "${tableName}_owservable_ins" AFTER INSERT ON "${tableName}" BEGIN
	INSERT INTO "${JOURNAL_TABLE}" (table_name, op, pk, changed) VALUES ('${tableName}', 'insert', NEW."${pkColumn}", NULL);
END`,
	`DROP TRIGGER IF EXISTS "${tableName}_owservable_upd"`,
	`CREATE TRIGGER "${tableName}_owservable_upd" AFTER UPDATE ON "${tableName}" BEGIN
	INSERT INTO "${JOURNAL_TABLE}" (table_name, op, pk, changed) VALUES ('${tableName}', 'update', NEW."${pkColumn}", ${_changedExpression(columns)});
END`,
	`DROP TRIGGER IF EXISTS "${tableName}_owservable_del"`,
	`CREATE TRIGGER "${tableName}_owservable_del" AFTER DELETE ON "${tableName}" BEGIN
	INSERT INTO "${JOURNAL_TABLE}" (table_name, op, pk, changed) VALUES ('${tableName}', 'delete', OLD."${pkColumn}", NULL);
END`
];

const installSqliteTriggers = async (orm: any, entities: any[]): Promise<void> => {
	const connection: any = orm.em.getConnection();

	for (const statement of _journalTableSql()) {
		await connection.execute(statement);
	}

	for (const entity of entities) {
		const meta: any = orm.getMetadata().get(entity.name);
		const tableName: string = meta.tableName;
		const pkProperty: string = meta.primaryKeys[0];
		const pkColumn: string = meta.properties[pkProperty]?.fieldNames?.[0] ?? pkProperty;

		const columns: string[] = [];
		for (const prop of meta.props ?? []) {
			if ('scalar' !== String(prop.kind ?? 'scalar')) continue;
			for (const fieldName of prop.fieldNames ?? []) columns.push(fieldName);
		}

		for (const statement of _tableTriggersSql(tableName, pkColumn, columns)) {
			await connection.execute(statement);
		}
		console.log(`[@owservable/sqlite] -> installSqliteTriggers: live updates enabled for table "${tableName}"`);
	}
};
export default installSqliteTriggers;
