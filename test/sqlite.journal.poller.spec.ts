'use strict';

import SqliteJournalPoller from '../src/sqlite.journal.poller';

const SELECT_SQL: string = 'SELECT id, table_name, op, pk, changed FROM "_owservable_changes" WHERE id > ? ORDER BY id ASC';
const DELETE_SQL: string = 'DELETE FROM "_owservable_changes" WHERE id <= ?';

const FAKE_TIMER_OPTIONS: any = {doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'clearImmediate']};

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('sqlite.journal.poller tests', () => {
	let execute: jest.Mock;
	let orm: any;
	let logSpy: jest.SpyInstance;
	let errorSpy: jest.SpyInstance;

	beforeEach(() => {
		jest.useFakeTimers(FAKE_TIMER_OPTIONS);
		execute = jest.fn().mockResolvedValue([]);
		orm = {em: {getConnection: (): any => ({execute})}};
		logSpy = jest.spyOn(console, 'log').mockImplementation((): undefined => undefined);
		errorSpy = jest.spyOn(console, 'error').mockImplementation((): undefined => undefined);
	});

	afterEach(() => {
		SqliteJournalPoller.stop();
		jest.useRealTimers();
		jest.restoreAllMocks();
	});

	it('should tolerate stop when no instance exists', () => {
		expect((): void => SqliteJournalPoller.stop()).not.toThrow();
		expect(SqliteJournalPoller.instance).toBeUndefined();
	});

	it('should reuse the singleton and emit a live lifecycle event on init', () => {
		const poller: SqliteJournalPoller = SqliteJournalPoller.init(orm, 100);

		expect(SqliteJournalPoller.instance).toBe(poller);
		expect(SqliteJournalPoller.init(orm, 999)).toBe(poller);
		expect(logSpy).toHaveBeenCalledTimes(1);
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('polling "_owservable_changes" every 100ms'));

		const events: any[] = [];
		poller.lifecycle.subscribe((event: any): void => {
			events.push(event);
		});
		expect(events).toEqual([{type: 'live', timestamp: expect.any(Date)}]);
	});

	it('should poll with the default interval', async () => {
		SqliteJournalPoller.init(orm);

		await jest.advanceTimersByTimeAsync(249);
		expect(execute).not.toHaveBeenCalled();

		await jest.advanceTimersByTimeAsync(1);
		expect(execute).toHaveBeenCalledTimes(1);
		expect(execute).toHaveBeenCalledWith(SELECT_SQL, [0]);
	});

	it('should emit mapped notifications and advance the last seen id', async () => {
		const poller: SqliteJournalPoller = SqliteJournalPoller.init(orm, 100);
		const received: any[] = [];
		poller.notifications.subscribe((notification: any): void => {
			received.push(notification);
		});

		execute.mockResolvedValueOnce([
			{id: 1, table_name: 'users', op: 'insert', pk: 7, changed: null},
			{id: 2, table_name: 'users', op: 'update', pk: '7', changed: 'first_name,last_name,'},
			{id: 3, table_name: 'notes', op: 'update', pk: '8', changed: ''}
		]);

		await jest.advanceTimersByTimeAsync(100);

		expect(received).toEqual([
			{table: 'users', op: 'insert', id: '7', changed: null},
			{table: 'users', op: 'update', id: '7', changed: ['first_name', 'last_name']},
			{table: 'notes', op: 'update', id: '8', changed: null}
		]);

		await jest.advanceTimersByTimeAsync(100);
		expect(execute).toHaveBeenNthCalledWith(2, SELECT_SQL, [3]);
	});

	it('should prune the journal on the 40th poll', async () => {
		SqliteJournalPoller.init(orm, 100);
		execute.mockResolvedValueOnce([{id: 5, table_name: 'users', op: 'insert', pk: '1', changed: null}]);

		await jest.advanceTimersByTimeAsync(3900);
		expect(execute.mock.calls.filter((call: any[]): boolean => DELETE_SQL === call[0])).toHaveLength(0);

		await jest.advanceTimersByTimeAsync(100);
		expect(execute.mock.calls.filter((call: any[]): boolean => DELETE_SQL === call[0])).toEqual([[DELETE_SQL, [5]]]);
		expect(execute).toHaveBeenCalledTimes(41);
	});

	it('should skip a poll while the previous one is still running', async () => {
		SqliteJournalPoller.init(orm, 100);
		let resolveHang: any;
		execute.mockImplementationOnce(
			(): Promise<any[]> =>
				new Promise((resolve): void => {
					resolveHang = resolve;
				})
		);

		await jest.advanceTimersByTimeAsync(100);
		await jest.advanceTimersByTimeAsync(100);
		expect(execute).toHaveBeenCalledTimes(1);

		resolveHang([]);
		await flush();

		await jest.advanceTimersByTimeAsync(100);
		expect(execute).toHaveBeenCalledTimes(2);
	});

	it('should log poll errors and emit an error lifecycle event', async () => {
		const poller: SqliteJournalPoller = SqliteJournalPoller.init(orm, 100);
		const events: any[] = [];
		poller.lifecycle.subscribe((event: any): void => {
			events.push(event);
		});
		execute.mockRejectedValueOnce(new Error('boom'));

		await jest.advanceTimersByTimeAsync(100);

		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('SqliteJournalPoller poll error'), expect.any(Error));
		expect(events).toEqual([
			{type: 'live', timestamp: expect.any(Date)},
			{type: 'error', timestamp: expect.any(Date), error: expect.any(Error)}
		]);
	});

	it('should clear the interval and emit a close lifecycle event on stop', async () => {
		const poller: SqliteJournalPoller = SqliteJournalPoller.init(orm, 100);
		const events: any[] = [];
		poller.lifecycle.subscribe((event: any): void => {
			events.push(event);
		});

		await jest.advanceTimersByTimeAsync(100);
		expect(execute).toHaveBeenCalledTimes(1);

		SqliteJournalPoller.stop();

		expect(SqliteJournalPoller.instance).toBeNull();
		expect(events.some((event: any): boolean => 'close' === event.type)).toBe(true);

		await jest.advanceTimersByTimeAsync(1000);
		expect(execute).toHaveBeenCalledTimes(1);
	});
});
