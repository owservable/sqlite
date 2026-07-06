'use strict';

export class SqliteLiveUpdatesRegistry {
	public static add(entity: any): void {
		SqliteLiveUpdatesRegistry._entities.add(entity);
	}

	public static has(entity: any): boolean {
		return SqliteLiveUpdatesRegistry._entities.has(entity);
	}

	public static entities(): any[] {
		return Array.from(SqliteLiveUpdatesRegistry._entities);
	}

	public static clear(): void {
		SqliteLiveUpdatesRegistry._entities.clear();
	}

	private static readonly _entities: Set<any> = new Set<any>();

	private constructor() {}
}

const SqliteLiveUpdates = (): ClassDecorator => {
	return (target: any): void => {
		SqliteLiveUpdatesRegistry.add(target);
	};
};
export default SqliteLiveUpdates;
