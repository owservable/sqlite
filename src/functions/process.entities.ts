'use strict';

import * as fs from 'node:fs';
import * as path from 'node:path';

import {endsWith, find, isString} from 'lodash';
import {listSubfoldersByName, type ItemStat} from '@owservable/folders';

const _processFile = (folder: string, file: string, entities: any[]): void => {
	const fullPath: string = path.join(folder, file);
	const entity: any = require(fullPath).default;
	if (!entity) throw new Error(`Entity not found in ${folder}/${file}`);
	entities.push(entity);
};

const _isExcluded = (folder: string, exclude: string | string[]): boolean => {
	if (!exclude) return false;
	return isString(exclude) //
		? endsWith(folder, exclude) //
		: !!find(exclude, (e: string) => endsWith(folder, e));
};

const _processSqliteEntities = (folder: string, entities: any[], exclude?: string | string[]): void => {
	if (_isExcluded(folder, exclude)) return;

	const subfolderNames: string[] = fs.readdirSync(folder);

	const itemStats: ItemStat[] = subfolderNames.map((fileName: string): ItemStat => {
		const fullPath: string = path.join(folder, fileName);
		const stat: fs.Stats = fs.lstatSync(fullPath);
		return {
			name: fileName,
			fullPath,
			isDirectory: stat.isDirectory()
		};
	});

	const files: ItemStat[] = itemStats.filter((item: ItemStat): boolean => !item.isDirectory);
	const folders: ItemStat[] = itemStats.filter((item: ItemStat): boolean => item.isDirectory);

	files.forEach((file: ItemStat): void => {
		const ext: string = path.extname(file.name);
		if (ext !== '.ts' && ext !== '.js') return;
		_processFile(folder, file.name, entities);
	});

	folders.forEach((subFolder: ItemStat): void => _processSqliteEntities(subFolder.fullPath, entities, exclude));
};

const processSqliteEntities = (root: string, name: string = 'entities', exclude?: string | string[]): any[] => {
	const entities: any[] = [];
	const folders: string[] = listSubfoldersByName(root, name);
	folders.forEach((folder: string): void => _processSqliteEntities(folder, entities, exclude));
	return entities;
};

export default processSqliteEntities;
