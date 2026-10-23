import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';

import * as utils from '../src/utils';

describe('read and write', () => {
	let formats = [
		'{\n  "name": "a",\n  "version": "1.0.0"\n}',
		'{\n\t"name": "a",\n\t"version": "1.0.0"\n}\n',
		'{\n    "name": "a",\n    "version": "1.0.0"\n}\n',
		'{"name":"a","version":"1.0.0"}',
	];

	test('keep the indent and final newline of the file', () => {
		let dir = mkdtempSync(join(tmpdir(), 'bump-utils-'));
		try {
			let file = join(dir, 'package.json');
			for (let text of formats) {
				writeFileSync(file, text);
				let json = utils.read<{ version: string }>(file);
				json.value.version = '2.0.0';
				utils.write(file, json);
				expect(readFileSync(file, 'utf8')).toBe(text.replace('1.0.0', '2.0.0'));
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe('range', () => {
	test('sets the version and keeps the prefix', () => {
		expect(utils.range('^1.0.0', '2.0.0')).toBe('^2.0.0');
		expect(utils.range('~1.2.3', '1.3.0')).toBe('~1.3.0');
		expect(utils.range('1.0.0', '1.1.0')).toBe('1.1.0');
		expect(utils.range('=1.0.0', '1.1.0')).toBe('=1.1.0');
		expect(utils.range('^1.0.0-next.1', '1.0.0')).toBe('^1.0.0');
	});

	test('keeps workspace, tag, path, and compound ranges', () => {
		for (let spec of ['workspace:*', 'workspace:^', '*', 'latest', 'file:../a', '>=1.0.0 <2', '1.x', 'npm:a@^1.0.0']) {
			expect(utils.range(spec, '2.0.0')).toBe(spec);
		}
	});
});

describe('bump', () => {

	test('should be a function', () => {
		expect(utils.bump).toBeTypeOf('function');
	});

	test('throws on invalid format', () => {
		expect(() => utils.bump('', 'patch')).toThrow();
		expect(() => utils.bump('1.', 'patch')).toThrow();
		expect(() => utils.bump('0.0', 'patch')).toThrow();
	});

	test('throws on invalid value segment', () => {
		expect(() => utils.bump('0.0.a', 'patch')).toThrow();
		expect(() => utils.bump('0.!.1', 'minor')).toThrow();
		expect(() => utils.bump('$.1.1', 'major')).toThrow();
	});

	test('should handle "major" bump', () => {
		expect(utils.bump('0.0.0', 'major')).toBe('1.0.0');
		expect(utils.bump('1.13.45', 'major')).toBe('2.0.0');
		expect(utils.bump('9.0.1234', 'major')).toBe('10.0.0');
		expect(utils.bump('99.91.919', 'major')).toBe('100.0.0');

		expect(utils.bump('1.0.0-next.1', 'major')).toBe('1.0.0');
		expect(utils.bump('3.0.0-beta.9', 'major')).toBe('3.0.0');
	});

	test('should handle "minor" bump', () => {
		expect(utils.bump('0.0.0', 'minor')).toBe('0.1.0');
		expect(utils.bump('1.13.45', 'minor')).toBe('1.14.0');
		expect(utils.bump('9.9.1234', 'minor')).toBe('9.10.0');
		expect(utils.bump('99.91.919', 'minor')).toBe('99.92.0');

		expect(utils.bump('1.2.0-next.12', 'minor')).toBe('1.2.0');
		expect(utils.bump('3.12.0-beta.9', 'minor')).toBe('3.12.0');
	});

	test('should handle "patch" bump', () => {
		expect(utils.bump('0.0.0', 'patch')).toBe('0.0.1');
		expect(utils.bump('1.13.45', 'patch')).toBe('1.13.46');
		expect(utils.bump('9.9.1234', 'patch')).toBe('9.9.1235');
		expect(utils.bump('99.91.919', 'patch')).toBe('99.91.920');

		expect(utils.bump('1.2.1-next.1', 'patch')).toBe('1.2.1');
		expect(utils.bump('3.2.1-beta.9', 'patch')).toBe('3.2.1');
	});

	test('should handle "premajor" bump', () => {
		expect(utils.bump('0.0.0', 'premajor')).toBe('1.0.0-next.0');
		expect(utils.bump('1.13.45', 'premajor')).toBe('2.0.0-next.0');

		expect(utils.bump('1.0.0-next.0', 'premajor')).toBe('1.0.0-next.1');
		expect(utils.bump('2.0.0-next.99', 'premajor')).toBe('2.0.0-next.100');
		// expect(utils.bump('1.2.0-next.99', 'premajor')).toBe('2.0.0-next.0');
	});

	test('should handle "preminor" bump', () => {
		expect(utils.bump('0.0.0', 'preminor')).toBe('0.1.0-next.0');
		expect(utils.bump('1.13.45', 'preminor')).toBe('1.14.0-next.0');

		expect(utils.bump('0.1.0-next.0', 'preminor')).toBe('0.1.0-next.1');
		expect(utils.bump('1.13.0-next.0', 'preminor')).toBe('1.13.0-next.1');
		expect(utils.bump('1.2.0-next.99', 'preminor')).toBe('1.2.0-next.100');
	});

	test('should handle "prepatch" bump', () => {
		expect(utils.bump('0.0.0', 'prepatch')).toBe('0.0.1-next.0');
		expect(utils.bump('1.13.45', 'prepatch')).toBe('1.13.46-next.0');

		expect(utils.bump('0.0.1-next.0', 'prepatch')).toBe('0.0.1-next.1');
		expect(utils.bump('1.13.46-next.0', 'prepatch')).toBe('1.13.46-next.1');
		expect(utils.bump('1.2.1-next.99', 'prepatch')).toBe('1.2.1-next.100');
	});
});
