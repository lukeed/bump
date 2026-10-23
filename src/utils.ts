import { readFileSync, writeFileSync } from 'node:fs';

import type { Version } from '..';

export type Json<T> = {
	value: T;
	indent: string;
	newline: boolean;
};

/**
 * Read a JSON file, and remember its indent and final newline, so `write()` keeps them.
 * @example let file = read<Config>('bump.json'); file.value.version //=> '1.0.0'
 */
export function read<T>(file: string): Json<T> {
	let text = readFileSync(file, 'utf8');
	let indent = /^[\t ]+(?=")/m.exec(text)?.[0] ?? (text.trim().includes('\n') ? '  ' : '');
	return { value: JSON.parse(text), indent, newline: text.endsWith('\n') };
}

/**
 * Write a JSON file with the format that `read()` found.
 * @example write('bump.json', { ...file, value: { ...file.value, version: '1.1.0' } })
 */
export function write<T>(file: string, json: Json<T>): void {
	writeFileSync(file, JSON.stringify(json.value, null, json.indent) + (json.newline ? '\n' : ''));
}

/**
 * The range `spec` with its version set to `next`, keeping its `^`, `~`, or `=` prefix.
 * Workspace, tag, path, and compound ranges stay as they are.
 * @example range('^1.0.0', '2.0.0') //=> '^2.0.0'
 * @example range('workspace:*', '2.0.0') //=> 'workspace:*'
 */
export function range(spec: string, next: string): string {
	let match = /^(\^|~|=)?v?\d+\.\d+\.\d+(-[\w.-]+)?$/.exec(spec.trim());
	return match ? (match[1] ?? '') + next : spec;
}

/**
 * The version after a `type` bump. A prerelease uses the `preid` tag.
 * @example bump('1.2.3', 'minor') //=> '1.3.0'
 * @example bump('1.2.3', 'preminor') //=> '1.3.0-next.0'
 */
export function bump(version: string, type: Version, preid = 'next'): string {
	let num: number, idx: number, arr = version.split('.');
	if (arr.length < 3) throw new Error(`Invalid "version" format: "${version}"`);

	let ptag = '-' + preid;
	// TODO: preid matches
	// 		 ? continue : restart
	let isPre = type.startsWith('pre');
	let wasPre = /\d+[.-]/.test(arr[2]);

	if (type === 'premajor') {
		num = +arr[idx = wasPre ? 3 : 0];
	} else if (type === 'preminor') {
		num = +arr[idx = wasPre ? 3 : 1];
	} else if (type === 'prepatch') {
		num = +arr[idx = wasPre ? 3 : 2];
	} else if (wasPre) {
		arr[2] = arr[2].split(/[-.]/)[0];
		return arr.slice(0, 3).join('.');
	} else if (type === 'major') {
		num = +arr[idx=0];
	} else if (type === 'minor') {
		num = +arr[idx=1];
	} else if (type === 'patch') {
		num = +arr[idx=2];
	} else {
		throw new Error(`Unknown "${type}" bump`);
	}

	if (num !== num) {
		throw new Error(`Invalid version: "${version}"`);
	}

	arr[idx] = String(num + 1);
	while (++idx < arr.length) arr[idx] = '0';

	if (isPre && !wasPre) {
		arr[2] += ptag;
		arr.push('0');
	}

	return arr.join('.');
}
