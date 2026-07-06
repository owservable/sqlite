'use strict';

import {each, get} from 'lodash';
import {Subject} from 'rxjs';
import {filter, skip} from 'rxjs/operators';

import SqliteJournalPoller, {SqliteNotificationType} from '../sqlite.journal.poller';

class SqliteObservableTable extends Subject<any> {
	private readonly _orm: any;
	private readonly _entity: any;
	private readonly _tableName: string;
	private readonly _pkProperty: string;
	private readonly _pkIsNumeric: boolean;
	private readonly _columnsToProperties: Map<string, string>;

	constructor(orm: any, entity: any, poller: SqliteJournalPoller) {
		super();

		this._orm = orm;
		this._entity = entity;

		const meta: any = orm.getMetadata().get(entity.name);
		this._tableName = meta.tableName;
		this._pkProperty = meta.primaryKeys[0];

		const pkProp: any = meta.properties[this._pkProperty];
		this._pkIsNumeric = ['number', 'integer', 'bigint', 'smallint', 'float', 'double', 'decimal'].includes(String(pkProp?.type ?? '').toLowerCase());

		this._columnsToProperties = new Map<string, string>();
		each(meta.props, (prop: any): void => {
			each(prop.fieldNames ?? [], (fieldName: string): void => {
				this._columnsToProperties.set(fieldName, prop.name);
			});
		});

		poller.notifications //
			.pipe(filter((notification: SqliteNotificationType): boolean => notification?.table === this._tableName))
			.subscribe({
				next: (notification: SqliteNotificationType): void => {
					this._process(notification) //
						.then((): null => null)
						.catch((error: any): void => {
							console.error(`[@owservable/sqlite] -> SqliteObservableTable[${this._tableName}] Error processing notification:`, {notification, error});
						});
				}
			});

		poller.lifecycle //
			.pipe(filter((event: any): boolean => 'live' === event?.type))
			.pipe(skip(1))
			.subscribe({
				next: (): void => this.next({})
			});
	}

	public get tableName(): string {
		return this._tableName;
	}

	public get pkProperty(): string {
		return this._pkProperty;
	}

	public coercePrimaryKey(id: string): any {
		return this._pkIsNumeric ? Number(id) : id;
	}

	private async _process(notification: SqliteNotificationType): Promise<void> {
		const {op: operationType, id, changed} = notification;

		const ns: any = {coll: this._tableName};
		const documentKey: any = {_id: id};

		if ('delete' === operationType) {
			return this.next({ns, documentKey, operationType});
		}

		const em: any = this._orm.em.fork();
		const entity: any = await em.findOne(this._entity, {[this._pkProperty]: this.coercePrimaryKey(id)});
		if (!entity) {
			return this.next({ns, documentKey, operationType});
		}

		const {wrap} = require('@mikro-orm/core');
		const fullDocument: any = wrap(entity).toObject();

		let updateDescription: any;
		if ('update' === operationType) {
			const updatedFields: any = {};
			each(changed ?? [], (column: string): void => {
				const property: string = this._columnsToProperties.get(column) ?? column;
				updatedFields[property] = get(fullDocument, property, true);
			});
			updateDescription = {updatedFields, removedFields: []};
		}

		this.next({ns, documentKey, operationType, updateDescription, fullDocument});
	}
}
export default SqliteObservableTable;
