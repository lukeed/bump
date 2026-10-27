import { describe, expect, test } from 'bun:test';

import * as semver from './semver';

describe('parse', () => {
	test('reads strict semver, with prerelease and build', () => {
		expect(semver.parse('1.3.0-next.2+abc')).toEqual({ major: 1, minor: 3, patch: 0, pre: ['next', '2'], build: 'abc' });
		expect(semver.parse('0.0.0')).toEqual({ major: 0, minor: 0, patch: 0, pre: [], build: undefined });
	});

	test('refuses loose versions', () => {
		for (let input of ['1.0', '01.0.0', 'v1.0.0', '1.0.0-', '1.0.0-01', ' 1.0.0', '1.0.0.0']) {
			expect(semver.parse(input)).toBeUndefined();
		}
	});
});

describe('identifier', () => {
	test('allows letters, digits, and hyphens, but not only digits', () => {
		expect(['next', 'rc', 'beta-2', 'a1'].map(semver.identifier)).toEqual([true, true, true, true]);
		expect(['1', '', 'rc.1', 'r c'].map(semver.identifier)).toEqual([false, false, false, false]);
	});
});

describe('inc', () => {
	let table = (from: string, rows: [Parameters<typeof semver.inc>[1], string, string?][]) => {
		for (let [type, out, preid] of rows) {
			expect(`${type} ${preid ?? ''}: ${semver.inc(from, type, preid)}`).toBe(`${type} ${preid ?? ''}: ${out}`);
		}
	};

	test('from a stable version', () => {
		table('1.2.3', [
			['major', '2.0.0'],
			['minor', '1.3.0'],
			['patch', '1.2.4'],
			['premajor', '2.0.0-next.0'],
			['preminor', '1.3.0-next.0'],
			['prepatch', '1.2.4-next.0'],
			['prerelease', '1.2.4-next.0'],
			['preminor', '1.3.0-rc.0', 'rc'],
		]);
	});

	test('from a prerelease', () => {
		table('1.3.0-next.2', [
			['patch', '1.3.0'],
			['minor', '1.3.0'],
			['major', '2.0.0'],
			['premajor', '2.0.0-next.0'],
			['preminor', '1.4.0-next.0'],
			['prepatch', '1.3.1-next.0'],
			['prerelease', '1.3.0-next.3'],
			['prerelease', '1.3.0-next.3', 'next'],
			['prerelease', '1.3.0-rc.0', 'rc'],
		]);
		table('1.3.1-next.0', [['minor', '1.4.0'], ['major', '2.0.0']]);
		table('2.0.0-next.3', [['major', '2.0.0'], ['minor', '2.0.0']]);
	});

	test('continues the current preid over the base', () => {
		expect(semver.inc('1.3.0-rc.1', 'prerelease', undefined, 'next')).toBe('1.3.0-rc.2');
		expect(semver.inc('1.2.3', 'prerelease', undefined, 'beta')).toBe('1.2.4-beta.0');
	});

	test('continues a bare preid from zero', () => {
		expect(semver.inc('1.3.0-alpha', 'prerelease')).toBe('1.3.0-alpha.0');
	});

	test('refuses to continue other prerelease forms', () => {
		for (let input of ['1.3.0-0', '1.3.0-a.b.c', '1.3.0-a.b']) {
			expect(() => semver.inc(input, 'prerelease')).toThrow(`Cannot continue the "${input}" prerelease; use an exact version`);
		}
		expect(semver.inc('1.3.0-0', 'prerelease', 'rc')).toBe('1.3.0-rc.0');
	});

	test('drops build metadata', () => {
		expect(semver.inc('1.2.0+abc', 'patch')).toBe('1.2.1');
		expect(semver.inc('1.2.0-next.0+abc', 'prerelease')).toBe('1.2.0-next.1');
	});

	test('refuses an invalid version', () => {
		expect(() => semver.inc('1.2', 'patch')).toThrow('Invalid version: "1.2"');
	});
});

describe('range', () => {
	test('keeps the prefix and the precision', () => {
		let rows: [string, string, string][] = [
			['^1.2.0', '2.0.0', '^2.0.0'],
			['~1.2.3', '1.3.0', '~1.3.0'],
			['=1.0.0', '1.1.0', '=1.1.0'],
			['1.0.0', '1.1.0', '1.1.0'],
			['1.2', '2.0.0', '2.0'],
			['^1.2', '1.3.0', '^1.3'],
			['1', '2.0.0', '2'],
			['1.2', '1.3.0-next.0', '1.3.0-next.0'],
			['v1.2.0', '1.3.0', '1.3.0'],
			['^1.0.0-next.1', '1.0.0', '^1.0.0'],
			[' ^1.0.0 ', '1.1.0', '^1.1.0'],
		];
		for (let [spec, next, out] of rows) expect(semver.range(spec, next)).toBe(out);
	});

	test('keeps workspace, tag, path, and compound ranges', () => {
		for (let spec of ['workspace:*', 'workspace:^', '*', 'latest', 'file:../a', '>=1.0.0 <2', '1.x', 'npm:a@^1.0.0', '1.2-next.0', '']) {
			expect(semver.range(spec, '2.0.0')).toBe(spec);
		}
	});
});

describe('compare and PATTERN', () => {
	test('order by semver precedence', () => {
		expect(semver.compare('1.3.0-next.2', '1.3.0')).toBe(-1);
		expect(semver.compare('1.3.0-beta.0', '1.3.0-next.2')).toBe(-1);
		expect(semver.compare('1.10.0', '1.9.0')).toBe(1);
	});

	test('PATTERN matches a whole version without build', () => {
		let re = new RegExp(`^${semver.PATTERN}$`);
		expect(['1.0.0', '1.0.0-rc.1', '10.20.30-a-b.0'].every(v => re.test(v))).toBe(true);
		expect(['1.0', '1.0.0+b', '01.0.0'].some(v => re.test(v))).toBe(false);
	});
});
