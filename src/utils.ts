import * as fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';

import type { Version } from '..';

export const exec = promisify(execFile);
export const write = promisify(fs.writeFile);
export const read = promisify(fs.readFile);
export const lstat = promisify(fs.lstat);
export const exists = fs.existsSync;

export function bump(version: string, type: Version): string | never {
	let num: number, idx: number, arr = version.split('.');
	if (arr.length < 3) throw new Error(`Invalid "version" format: "${version}"`);

	if (type === 'major') {
		num = +arr[idx=0];
	} else if (type === 'minor') {
		num = +arr[idx=1];
	} else if (type === 'patch') {
		num = +arr[idx=2];
	} else {
		throw new Error(`TODO: implement "${type}" bump`);
	}

	if (num !== num) {
		throw new Error(`Invalid version: "${version}"`);
	}

	arr[idx] = String(num + 1);
	return arr.join('.');
}
