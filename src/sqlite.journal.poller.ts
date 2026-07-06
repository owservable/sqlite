'use strict';

import {ReplaySubject, Subject} from 'rxjs';

export type SqliteNotificationType = {
	table: string;
	op: string;
	id: string;
	changed: string[] | null;
};

const JOURNAL_TABLE: string = '_owservable_changes';
const PRUNE_EVERY_POLLS: number = 40;

export default class SqliteJournalPoller {
	public static init(orm: any, pollIntervalMs: number = 250): SqliteJournalPoller {
		if (!SqliteJournalPoller._instance) SqliteJournalPoller._instance = new SqliteJournalPoller(orm, pollIntervalMs);
		return SqliteJournalPoller._instance;
	}

	public static get instance(): SqliteJournalPoller {
		return SqliteJournalPoller._instance;
	}

	public static stop(): void {
		if (!SqliteJournalPoller._instance) return;
		SqliteJournalPoller._instance._stop();
		SqliteJournalPoller._instance = null;
	}

	public readonly notifications: Subject<SqliteNotificationType>;
	public readonly lifecycle: ReplaySubject<any>;

	private readonly _orm: any;
	private _interval: any;
	private _lastSeen: number;
	private _pollCount: number;
	private _polling: boolean;

	private static _instance: SqliteJournalPoller;

	private constructor(orm: any, pollIntervalMs: number) {
		this._orm = orm;
		this._lastSeen = 0;
		this._pollCount = 0;
		this._polling = false;

		this.notifications = new Subject<SqliteNotificationType>();
		this.lifecycle = new ReplaySubject<any>(1);

		this._interval = setInterval((): void => {
			this._poll() //
				.then((): null => null)
				.catch((error: any): void => {
					console.error('[@owservable/sqlite] -> SqliteJournalPoller poll error:', error);
					this.lifecycle.next({type: 'error', timestamp: new Date(), error});
				});
		}, pollIntervalMs);

		this.lifecycle.next({type: 'live', timestamp: new Date()});
		console.log(`[@owservable/sqlite] -> SqliteJournalPoller polling "${JOURNAL_TABLE}" every ${pollIntervalMs}ms`);
	}

	private async _poll(): Promise<void> {
		if (this._polling) return;
		this._polling = true;

		try {
			const connection: any = this._orm.em.getConnection();
			const rows: any[] = await connection.execute(`SELECT id, table_name, op, pk, changed FROM "${JOURNAL_TABLE}" WHERE id > ? ORDER BY id ASC`, [this._lastSeen]);

			for (const row of rows) {
				this._lastSeen = row.id;
				this.notifications.next({
					table: String(row.table_name),
					op: String(row.op),
					id: String(row.pk),
					changed: row.changed ? String(row.changed).split(',').filter(Boolean) : null
				});
			}

			this._pollCount++;
			if (this._pollCount >= PRUNE_EVERY_POLLS) {
				this._pollCount = 0;
				await connection.execute(`DELETE FROM "${JOURNAL_TABLE}" WHERE id <= ?`, [this._lastSeen]);
			}
		} finally {
			this._polling = false;
		}
	}

	private _stop(): void {
		clearInterval(this._interval);
		this._interval = null;
		this.lifecycle.next({type: 'close', timestamp: new Date()});
	}
}
