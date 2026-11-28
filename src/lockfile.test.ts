import { execFileSync } from 'node:child_process';
import { chmodSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { afterEach, beforeAll, describe, expect, test } from 'bun:test';

import * as h from './harness';

beforeAll(h.build);
afterEach(h.clean);

type Manager = {
	file: string;
	install: string[];
	frozen: string[];
	extra?: Record<string, string>;
	range: string;
};

const MANAGERS: Record<string, Manager> = {
	npm: { file: 'package-lock.json', install: ['npm', 'install', '--ignore-scripts'], frozen: ['npm', 'ci', '--ignore-scripts'], range: '^1.0.0' },
	bun: { file: 'bun.lock', install: ['bun', 'install'], frozen: ['bun', 'install', '--frozen-lockfile'], range: '^1.0.0' },
	pnpm: { file: 'pnpm-lock.yaml', install: ['pnpm', 'install', '--no-frozen-lockfile'], frozen: ['pnpm', 'install', '--frozen-lockfile'], extra: { 'pnpm-workspace.yaml': 'packages:\n  - "packages/*"\n' }, range: 'workspace:^' },
	yarn: { file: 'yarn.lock', install: ['yarn', 'install', '--no-immutable'], frozen: ['yarn', 'install', '--immutable'], extra: { '.yarnrc.yml': 'nodeLinker: node-modules\nenableTelemetry: false\n' }, range: 'workspace:^' },
};

let run = (r: h.Repo, [binary, ...args]: string[]) => execFileSync(binary, args, { cwd: r.dir, env: { ...r.env, CI: '1' }, encoding: 'utf8', stdio: 'pipe' });

let workspace = (manager: Manager) => {
	let base = h.repo({
		'.gitignore': '.home\nnode_modules\n.yarn\n.pnp.*\n',
		'package.json': h.manifest('root', undefined, { private: true, workspaces: ['packages/*'] }),
		'packages/a/package.json': h.manifest('a', '1.0.0'),
		'packages/b/package.json': h.manifest('b', '1.0.0', { dependencies: { a: manager.range } }),
		...manager.extra,
	});
	let r = { ...base, env: { ...base.env, CI: '1' } };
	run(r, manager.install);
	h.git(r, 'add', '-A');
	h.git(r, 'commit', '--quiet', '--no-gpg-sign', '-m', 'lock');
	h.tag(r, 'v1.0.0');
	h.commit(r, { 'packages/a/x.js': '1' });
	return r;
};

describe('lockfiles', () => {
	for (let [name, manager] of Object.entries(MANAGERS)) {
		test(`${name}: the release commit holds a lockfile that a frozen install accepts`, () => {
			let r = workspace(manager);
			let release = h.bump(r, 'minor', '--json');
			expect(release.code).toBe(0);
			let { files } = JSON.parse(release.stdout);
			expect(files).toEqual(expect.arrayContaining(['packages/a/package.json', 'packages/b/package.json']));
			expect(h.git(r, 'status', '--porcelain')).toBe('');
			expect(() => run(r, manager.frozen)).not.toThrow();
		}, 60_000);
	}

	test('package-lock.json records the new versions', () => {
		let r = workspace(MANAGERS.npm);
		expect(h.bump(r, 'minor').code).toBe(0);
		let lock = JSON.parse(h.read(r, 'package-lock.json'));
		expect(lock.packages['packages/a'].version).toBe('1.1.0');
		expect(lock.packages['packages/b'].dependencies).toEqual({ a: '^1.1.0' });
		expect(h.git(r, 'show', '--name-only', '--format=', 'HEAD')).toContain('package-lock.json');
	}, 60_000);

	test('an untracked lockfile is not updated', () => {
		let r = workspace(MANAGERS.npm);
		h.commit(r, { '.gitignore': '.home\nnode_modules\npackage-lock.json\n' });
		h.git(r, 'rm', '--quiet', '--cached', 'package-lock.json');
		h.git(r, 'commit', '--quiet', '--no-gpg-sign', '-m', 'untrack');
		let before = h.read(r, 'package-lock.json');
		expect(h.bump(r, 'minor').code).toBe(0);
		expect(h.read(r, 'package-lock.json')).toBe(before);
	}, 60_000);

	test('a failing lockfile command undoes the release, and a dry run runs nothing', () => {
		let r = workspace(MANAGERS.npm);
		h.shim(r, 'npm', "if (process.argv[2] === '--version') console.log('10.0.0');\nelse {\n\tconsole.error('npm broke');\n\tprocess.exit(1);\n}\n");
		let dry = h.bump(r, 'minor', '--dryrun', '--json');
		expect(dry.code).toBe(0);
		expect(JSON.parse(dry.stdout).files).toEqual(['package-lock.json', 'packages/a/package.json', 'packages/b/package.json']);

		let head = h.git(r, 'rev-parse', 'HEAD');
		let failed = h.bump(r, 'minor');
		expect(failed.stderr).toBe('FAIL Could not update "package-lock.json": npm broke\n│    The release was undone: no files, commits, or tags changed.\n');
		expect(h.git(r, 'rev-parse', 'HEAD')).toBe(head);
		expect(h.git(r, 'status', '--porcelain')).toBe('');
	}, 60_000);

	test('a missing package manager is an error before any write', () => {
		let r = workspace(MANAGERS.pnpm);
		let env = { ...r.env, PATH: [join(r.dir, '.home', 'bin'), ...(process.env.PATH ?? '').split(delimiter).filter(dir => !Bun.which('pnpm', { PATH: dir }))].join(delimiter) };
		let run = Bun.spawnSync([process.execPath, join(import.meta.dirname, '..', 'bin.js'), 'minor'], { cwd: r.dir, env });
		expect(run.stderr.toString()).toBe(`FAIL Missing "pnpm" binary to update "${join(r.dir, 'pnpm-lock.yaml')}"\n`);
		expect(h.git(r, 'status', '--porcelain')).toBe('');
	}, 60_000);

	test('a Yarn 1 lockfile gets a warning, and is not updated', () => {
		let r = h.repo({
			'package.json': h.manifest('root', undefined, { private: true, workspaces: ['packages/*'] }),
			'packages/a/package.json': h.manifest('a', '1.0.0'),
			'yarn.lock': '# yarn lockfile v1\n',
		}, { tag: 'v1.0.0' });
		h.shim(r, 'yarn', "if (process.argv[2] === '--version') console.log('1.22.22');\nelse process.exit(1);\n");
		h.commit(r, { 'packages/a/x.js': '1' });
		let release = h.bump(r, 'minor');
		expect(release).toMatchObject({ code: 0, stderr: `WARN Yarn 1 cannot update "${join(r.dir, 'yarn.lock')}" without an install; the lockfile is not updated\n` });
	});

	test('the undo restores a binary lockfile byte for byte', () => {
		let r = h.repo({
			'package.json': h.manifest('root', undefined, { private: true, workspaces: ['packages/*'] }),
			'packages/a/package.json': h.manifest('a', '1.0.0'),
		}, { tag: 'v1.0.0' });
		let bytes = Buffer.from([0x23, 0x21, 0xff, 0xfe, 0x00, 0x80, 0x0a]);
		require('node:fs').writeFileSync(join(r.dir, 'bun.lockb'), bytes);
		h.commit(r, { 'packages/a/x.js': '1' });
		h.shim(r, 'bun', "if (process.argv[2] === '--version') console.log('1.4.4');\nelse require('node:fs').writeFileSync('bun.lockb', 'changed');\n");
		h.write(r, { '.git/hooks/pre-commit': '#!/bin/sh\nexit 1\n' });
		chmodSync(join(r.dir, '.git/hooks/pre-commit'), 0o755);

		expect(h.bump(r, 'minor').code).toBe(1);
		expect(require('node:fs').readFileSync(join(r.dir, 'bun.lockb')).equals(bytes)).toBe(true);
		expect(h.git(r, 'status', '--porcelain')).toBe('');
	});

	test('a lockfile that its package manager removes is an error, and comes back', () => {
		let r = workspace(MANAGERS.npm);
		h.shim(r, 'npm', "if (process.argv[2] === '--version') console.log('10.0.0');\nelse require('node:fs').rmSync('package-lock.json');\n");
		let run = h.bump(r, 'minor');
		expect(run.stderr).toBe('FAIL Could not update "package-lock.json": `npm install --package-lock-only --ignore-scripts` removed it\n│    The release was undone: no files, commits, or tags changed.\n');
		expect(h.git(r, 'status', '--porcelain')).toBe('');
	}, 60_000);
});
