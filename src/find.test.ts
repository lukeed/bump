import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, test } from 'bun:test';

import * as config from './config';
import * as find from './find';
import * as h from './harness';

beforeAll(h.build);
afterEach(h.clean);

let discover = async (files: Record<string, string>) => {
	let r = h.repo(files);
	let warnings: string[] = [];
	let list = find.packages(await config.load(r.dir), message => warnings.push(message));
	return { r, warnings, names: list.map(pkg => `${pkg.ecosystem}:${pkg.name}`) };
};

describe('dirs', () => {
	test('matches folders, skips dot folders and node_modules, and excludes parents', () => {
		let r = h.repo({
			'packages/a/x': '',
			'packages/internal-b/sub/x': '',
			'packages/file.txt': '',
			'packages/.hidden/x': '',
			'packages/node_modules/x/y': '',
		});
		let rel = (dirs: string[]) => dirs.map(dir => dir.slice(r.dir.length + 1) || '.');
		expect(rel(find.dirs(r.dir, ['packages/*', './packages/a/', '.']))).toEqual(['.', 'packages/a', 'packages/internal-b']);
		expect(rel(find.dirs(r.dir, ['packages/**'], ['packages/internal-*']))).toEqual(['packages/a']);
	});
});

describe('packages', () => {
	test('uses package.json workspaces in both forms, and pnpm-workspace.yaml', async () => {
		let array = await discover({
			'package.json': h.manifest('root', undefined, { workspaces: ['a'] }),
			'pnpm-workspace.yaml': 'packages:\n  - b\n',
			'a/package.json': h.manifest('a', '1.0.0'),
			'b/package.json': h.manifest('b', '1.0.0'),
			'c/package.json': h.manifest('c', '1.0.0'),
		});
		expect(array.names).toEqual(['npm:a', 'npm:b']);

		let object = await discover({
			'package.json': h.manifest('root', undefined, { workspaces: { packages: ['a'] } }),
			'a/package.json': h.manifest('a', '1.0.0'),
		});
		expect(object.names).toEqual(['npm:a']);
	});

	test('keeps a member set per ecosystem', async () => {
		let { names } = await discover({
			'package.json': h.manifest('root', undefined, { workspaces: ['js/*'] }),
			'Cargo.toml': '[workspace]\nmembers = ["rs/*"]\n',
			'js/a/package.json': h.manifest('a', '1.0.0'),
			'js/a/Cargo.toml': h.crate('a-rs', '1.0.0'),
			'rs/b/Cargo.toml': h.crate('b', '1.0.0'),
			'rs/b/package.json': h.manifest('b-js', '1.0.0'),
		});
		expect(names).toEqual(['npm:a', 'cargo:b']);
	});

	test('a "packages" glob checks every adapter, and a folder can hold two packages', async () => {
		let { names } = await discover({
			'bump.json': '{ "packages": ["."] }',
			'package.json': h.manifest('@acme/fast', '1.0.0'),
			'Cargo.toml': h.crate('acme-fast', '1.0.0'),
		});
		expect(names).toEqual(['npm:@acme/fast', 'cargo:acme-fast']);
	});

	test('warns about a manifest without a name, but not about a virtual Cargo manifest', async () => {
		let { r, warnings, names } = await discover({
			'bump.json': '{ "packages": ["*"] }',
			'a/package.json': '{ "version": "1.0.0" }',
			'b/Cargo.toml': '[workspace]\nmembers = []\n',
			'c/Cargo.toml': '[package]\nversion = "1.0.0"\n',
			'd/package.json': h.manifest('d', '1.0.0'),
		});
		expect(names).toEqual(['npm:d']);
		expect(warnings).toEqual([`Missing "name" field in "${join(r.dir, 'a/package.json')}"`, `Missing "package.name" field in "${join(r.dir, 'c/Cargo.toml')}"`]);
	});

	test('refuses duplicate names, invalid versions, and repositories without releasable packages', async () => {
		let r = h.repo({ 'bump.json': '{ "packages": ["*"] }', 'a/package.json': h.manifest('x', '1.0.0'), 'b/Cargo.toml': h.crate('x', '1.0.0') });
		expect(() => find.packages({ ...defaults(r), packages: ['*'] }, () => {})).toThrow(`Two packages are named "x": "${join(r.dir, 'a/package.json')}" and "${join(r.dir, 'b/Cargo.toml')}"`);
		expect(() => find.packages({ ...defaults(r), packages: ['none'] }, () => {})).toThrow('No packages found');

		h.write(r, { 'c/package.json': h.manifest('c', undefined), 'd/package.json': h.manifest('d', '1.0') });
		expect(() => find.packages({ ...defaults(r), packages: ['c'] }, () => {})).toThrow('No versioned packages found');
		expect(() => find.packages({ ...defaults(r), packages: ['d'] }, () => {})).toThrow(`Invalid version "1.0" in "${join(r.dir, 'd/package.json')}"`);
	});
});

function defaults(r: h.Repo): config.Config {
	return { root: r.dir, top: r.dir, independent: false, groups: {}, preid: 'next', tag: 'v{version}', message: 'v{version}' };
}

describe('exclusions', () => {
	test('a "!" pattern in workspace globs excludes', async () => {
		let { names } = await discover({
			'pnpm-workspace.yaml': 'packages:\n  - "packages/*"\n  - "!packages/internal"\n',
			'packages/a/package.json': h.manifest('a', '1.0.0'),
			'packages/internal/package.json': h.manifest('internal', '1.0.0'),
		});
		expect(names).toEqual(['npm:a']);
	});
});
