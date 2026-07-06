'use strict';

import SqliteLiveUpdates, {SqliteLiveUpdatesRegistry} from '../../src/decorators/live.updates';

describe('live.updates tests', () => {
	beforeEach(() => {
		SqliteLiveUpdatesRegistry.clear();
	});

	it('should register a class through the decorator', () => {
		class UserEntity {}

		const decorate: ClassDecorator = SqliteLiveUpdates();
		decorate(UserEntity as any);

		expect(SqliteLiveUpdatesRegistry.has(UserEntity)).toBe(true);
		expect(SqliteLiveUpdatesRegistry.entities()).toEqual([UserEntity]);
	});

	it('should report false for unregistered classes', () => {
		class NoteEntity {}

		expect(SqliteLiveUpdatesRegistry.has(NoteEntity)).toBe(false);
		expect(SqliteLiveUpdatesRegistry.entities()).toEqual([]);
	});

	it('should deduplicate entities added directly to the registry', () => {
		class TagEntity {}

		SqliteLiveUpdatesRegistry.add(TagEntity);
		SqliteLiveUpdates()(TagEntity);

		expect(SqliteLiveUpdatesRegistry.has(TagEntity)).toBe(true);
		expect(SqliteLiveUpdatesRegistry.entities()).toEqual([TagEntity]);
	});

	it('should be instantiable only through its static API', () => {
		expect(new (SqliteLiveUpdatesRegistry as any)()).toBeInstanceOf(SqliteLiveUpdatesRegistry);
	});

	it('should clear the registry', () => {
		class TagEntity {}

		SqliteLiveUpdatesRegistry.add(TagEntity);
		SqliteLiveUpdatesRegistry.clear();

		expect(SqliteLiveUpdatesRegistry.has(TagEntity)).toBe(false);
		expect(SqliteLiveUpdatesRegistry.entities()).toEqual([]);
	});
});
