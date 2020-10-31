import * as fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';

import type { Version } from '..';

export const exists = fs.existsSync;
export const exec = promisify(execFile);
export const write = promisify(fs.writeFile);
export const list = promisify(fs.readdir);
export const lstat = promisify(fs.lstat);

export function bump(version: string, type: Version, preid = 'next'): string | never {
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
