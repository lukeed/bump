import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, test } from 'bun:test';

import * as config from './config';
import * as h from './harness';

beforeAll(h.build);
afterEach(h.clean);

let load = (json: unknown) => {
	let r = h.repo({ 'bump.json': typeof json === 'string' ? json : JSON.stringify(json) });
	return config.load(r.dir);
};

describe('load', () => {
	test('uses defaults without bump.json, at the git top level', async () => {
		let r = h.repo({ 'a/b/x.txt': '' });
		expect(await config.load(join(r.dir, 'a/b'))).toEqual({
			root: r.dir,
			top: r.dir,
			independent: false,
			packages: undefined,
			groups: {},
			preid: 'next',
			tag: 'v{version}',
			message: 'v{version}',
		});
	});

	test('finds bump.json upward, but not above the git top level', async () => {
		let outer = realpathSync(mkdtempSync(join(tmpdir(), 'bump-outer-')));
		try {
			writeFileSync(join(outer, 'bump.json'), '{ "independent": true }');
			let r = h.repo({ 'sub/bump.json': '{ "independent": true, "packages": "*" }', 'sub/deep/x.txt': '' });
			Bun.spawnSync(['mv', r.dir, join(outer, 'repo')]);
			let dir = join(outer, 'repo');
			expect((await config.load(join(dir, 'sub/deep'))).root).toBe(join(dir, 'sub'));
			expect(await config.load(dir)).toMatchObject({ root: dir, independent: false });
		} finally {
			rmSync(outer, { recursive: true, force: true });
		}
	});

	test('uses independent defaults, and a packages string', async () => {
		expect(await load({ independent: true, packages: 'crates/*', preid: 'rc' })).toMatchObject({
			packages: ['crates/*'],
			preid: 'rc',
			tag: '{name}@{version}',
			message: 'release: {tags}',
		});
	});

	test('refuses a folder outside a git repository', async () => {
		let dir = realpathSync(mkdtempSync(join(tmpdir(), 'bump-none-')));
		try {
			await expect(config.load(dir)).rejects.toThrow(`Not a git repository: "${dir}"`);
			await expect(config.load(join(dir, 'missing'))).rejects.toThrow(`Missing directory: "${join(dir, 'missing')}"`);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test('refuses removed, unknown, and invalid keys', async () => {
		let cases: [unknown, string][] = [
			[{ version: '1.0.0' }, '"version" was removed: versions come from the manifests'],
			[{ single: true }, '"single" was removed: use "packages": ["."]'],
			[{ all: true }, '"all" was removed: use --all'],
			[{ nope: 1 }, 'Unknown "nope" key'],
			[{ independent: 'yes' }, '"independent" must be a boolean'],
			[{ packages: [] }, '"packages" must be a string or a non-empty array of strings'],
			[{ packages: [1] }, '"packages" must be a string or a non-empty array of strings'],
			[{ groups: [] }, '"groups" must be an object'],
			[{ independent: true, groups: { g: [] } }, '"groups.g" must be a non-empty array of package names'],
			[{ groups: { g: ['a'] } }, '"groups" needs "independent": true'],
			[{ preid: '1' }, 'Invalid "preid" value: "1"'],
			[{ tag: '' }, '"tag" must be a non-empty string'],
			[{ tag: 'v{name}{version}' }, 'Unknown "{name}" placeholder in "tag"'],
			[{ tag: 'release' }, 'Missing "{version}" placeholder in "tag"'],
			[{ independent: true, tag: 'v{version}' }, 'Missing "{name}" placeholder in "tag"'],
			[{ tag: 'v{version}}' }, 'Unmatched brace in "tag"'],
			[{ independent: true, message: 'v{version}' }, 'Unknown "{version}" placeholder in "message"'],
			[[], 'must hold a JSON object'],
			['{', 'Invalid JSON in'],
		];
		for (let [json, message] of cases) {
			await expect(load(json)).rejects.toThrow(message);
		}
		await expect(load({})).resolves.toBeDefined();
		await expect(load({ groups: {} })).resolves.toBeDefined();
		await expect(load({ $schema: 'x', tag: 'v{version}-{version}', message: '{tags} ({version})' })).resolves.toBeDefined();
	});
});
