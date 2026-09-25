'use strict';

import {Observable} from 'rxjs';
import {wrap} from '@mikro-orm/core';
import {cloneDeep, each, isEmpty, isPlainObject, isString, omit, setWith} from 'lodash';

import type {IObservableBackend} from '@owservable/core';

import SqliteJournalPoller from './sqlite.journal.poller';
import SqliteObservableTable from './functions/observable.table';
import SqliteObservableTablesMap from './functions/observable.tables.map';
import translateQuery from './functions/translate.query';

const DESCENDING_SORT_VALUES: string[] = ['-1', 'desc', 'descending'];
const UNSAFE_SORT_SEGMENTS: string[] = ['__proto__', 'constructor', 'prototype'];

export default class SqliteBackend implements IObservableBackend {
	private readonly _orm: any;
	private readonly _entity: any;
	private readonly _poller: SqliteJournalPoller;
	private readonly _meta: any;
	private readonly _tableName: string;
	private readonly _pkProperty: string;

	constructor(orm: any, entity: any, poller: SqliteJournalPoller) {
		this._orm = orm;
		this._entity = entity;
		this._poller = poller;

		this._meta = orm.getMetadata().get(entity.name);
		this._tableName = this._meta.tableName;
		this._pkProperty = this._meta.primaryKeys[0];
	}

	public target(): string {
		return this._tableName;
	}

	public changes(): Observable<any> {
		return this._observableTable();
	}

	public async find(query: any, fields: any, paging: any, sort: any, populates: any[]): Promise<any[]> {
		const options: any = {
			fields: this._translateFields(fields),
			orderBy: this._translateSort(sort),
			offset: paging?.skip,
			limit: paging?.limit,
			populate: this._translatePopulates(populates)
		};
		const em: any = this._orm.em.fork();
		const entities: any[] = await em.find(this._entity, this._translateQuery(query), options);
		return entities.map((entity: any): any => this._toObject(entity));
	}

	public async findOne(query: any, fields: any, populates: any[]): Promise<any> {
		const em: any = this._orm.em.fork();
		const entity: any = await em.findOne(this._entity, this._translateQuery(query), {
			fields: this._translateFields(fields),
			populate: this._translatePopulates(populates)
		});
		return entity ? this._toObject(entity) : entity;
	}

	public async findById(id: string, fields: any, populates: any[]): Promise<any> {
		const observableTable: SqliteObservableTable = this._observableTable();
		return this.findOne({[this._pkProperty]: observableTable.coercePrimaryKey(id)}, fields, populates);
	}

	public async count(query: any): Promise<number> {
		const em: any = this._orm.em.fork();
		return em.count(this._entity, this._translateQuery(query));
	}

	public async populate(document: any, _populate: any): Promise<any> {
		return document;
	}

	public toJSON(document: any): any {
		return document;
	}

	public async resolveVirtuals(document: any, virtuals: string[]): Promise<any> {
		const replacement: any = cloneDeep(omit(document, virtuals));
		for (const virtual of virtuals) {
			replacement[virtual] = await Promise.resolve(document[virtual]);
		}
		return replacement;
	}

	public get entity(): any {
		return this._entity;
	}

	private _observableTable(): SqliteObservableTable {
		return SqliteObservableTablesMap.get(this._orm, this._entity, this._poller);
	}

	private _toObject(entity: any): any {
		return wrap(entity).toObject();
	}

	private _translateQuery(query: any): any {
		return translateQuery(query, this._meta, {regex: false});
	}

	private _translateSort(sort: any): any {
		if (!isPlainObject(sort) || isEmpty(sort)) return undefined;

		const orderBy: any[] = [];
		each(Object.keys(sort), (key: string): void => {
			const path: string[] = key.split('.').filter(Boolean);
			if (isEmpty(path) || path.some((segment: string): boolean => UNSAFE_SORT_SEGMENTS.includes(segment))) return;
			orderBy.push(setWith({}, path, DESCENDING_SORT_VALUES.includes(String(sort[key]).toLowerCase()) ? 'desc' : 'asc', Object));
		});
		return isEmpty(orderBy) ? undefined : orderBy;
	}

	private _translateFields(fields: any): string[] | undefined {
		if (isEmpty(fields)) return undefined;
		if (Array.isArray(fields)) return fields;

		const included: string[] = Object.keys(fields).filter((key: string): boolean => !!fields[key]);
		return isEmpty(included) ? undefined : included;
	}

	private _translatePopulates(populates: any[]): string[] | undefined {
		if (isEmpty(populates)) return undefined;

		const paths: string[] = populates //
			.map((populate: any): string => (isString(populate) ? populate : populate?.path))
			.filter(Boolean);
		return isEmpty(paths) ? undefined : paths;
	}
}
