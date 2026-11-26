import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, test } from 'bun:test';

import * as config from './config';
import * as h from './harness';

beforeAll(h.build);
afterEach(() => {
	h.clean();
	shared = undefined;
});

let shared: h.Repo | undefined;
let load = (json: unknown) => {
	shared ??= h.repo({});
	h.write(shared, { 'bump.json': typeof json === 'string' ? json : JSON.stringify(json) });
	return config.load(shared.dir);
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

	test('reads bump.jsonc and bump.json as JSONC, but not both', async () => {
		let text = '{\n\t// lockstep\n\t"preid": "rc", /* why */\n\t"packages": ["packages/*",],\n}\n';
		let jsonc = h.repo({ 'bump.jsonc': text });
		expect(await config.load(jsonc.dir)).toMatchObject({ root: jsonc.dir, preid: 'rc', packages: ['packages/*'] });

		let json = h.repo({ 'bump.json': text });
		expect(await config.load(json.dir)).toMatchObject({ preid: 'rc' });

		let both = h.repo({ 'bump.json': '{}', 'bump.jsonc': '{}' });
		await expect(config.load(both.dir)).rejects.toThrow(`Keep one of "${join(both.dir, 'bump.json')}" and "${join(both.dir, 'bump.jsonc')}"`);
	});

	test('inline options replace the file, and name their source in errors', async () => {
		let r = h.repo({ 'bump.json': '{ "independent": true, "tag": "{name}-v{version}" }' });
		expect(await config.load(r.dir, { tag: '{name}@{version}', packages: 'crates/*' })).toMatchObject({ independent: true, tag: '{name}@{version}', packages: ['crates/*'] });
		await expect(config.load(r.dir, { independent: false })).rejects.toThrow(`Unknown "{name}" placeholder in "tag" in "${join(r.dir, 'bump.json')}"`);
		await expect(config.load(r.dir, { tag: 'v{version}' })).rejects.toThrow('Missing "{name}" placeholder in "tag" in the options');
		await expect(config.load(h.repo({}).dir, { independent: true, groups: { g: [] as unknown as [string] } })).rejects.toThrow('"groups.g" must be a non-empty array of package names in the options');
	});
});

describe('schema', () => {
	test('matches the keys that a config file can hold', async () => {
		let schema = await Bun.file(join(import.meta.dirname, '..', 'schema.json')).json();
		let { properties, additionalProperties } = schema.definitions.Config;
		expect(Object.keys(properties).sort()).toEqual([...config.KEYS].sort());
		expect(additionalProperties).toBe(false);
		expect(new RegExp(properties.preid.pattern).test('rc')).toBe(true);
		expect(new RegExp(properties.preid.pattern).test('7')).toBe(false);
	});
});
