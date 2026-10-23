import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeAll, describe, expect, test } from 'bun:test';

const ROOT = join(import.meta.dirname, '..');
const BIN = join(ROOT, 'bin.js');

type Repo = { dir: string; env: NodeJS.ProcessEnv };

let repos: string[] = [];

beforeAll(() => {
	execFileSync('bun', ['run', 'build'], { cwd: ROOT, stdio: 'ignore' });
});

afterEach(() => {
	for (let dir of repos) rmSync(dir, { recursive: true, force: true });
	repos = [];
});

const manifest = (name: string, version: string, extra: object = {}) => JSON.stringify({ name, version, ...extra }, null, 2) + '\n';

// A git repo with `files`, committed and tagged `v{version}`, with its own git config.
function repo(files: Record<string, string>, opts: { version?: string; config?: string; tag?: boolean } = {}): Repo {
	let dir = realpathSync(mkdtempSync(join(tmpdir(), 'bump-cli-')));
	repos.push(dir);
	let home = join(dir, '.home');
	mkdirSync(home);
	writeFileSync(join(home, '.gitconfig'), `[user]\n\tname = Test\n\temail = test@example.com\n[init]\n\tdefaultBranch = main\n${opts.config ?? ''}`);
	let env = { ...process.env, HOME: home, GIT_CONFIG_GLOBAL: join(home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1' };
	let version = opts.version ?? '1.0.0';
	let all: Record<string, string> = {
		'bump.json': JSON.stringify({ version, packages: ['packages'] }, null, 2) + '\n',
		'.gitignore': '.home\n',
		...files,
	};
	for (let [rel, text] of Object.entries(all)) {
		mkdirSync(dirname(join(dir, rel)), { recursive: true });
		writeFileSync(join(dir, rel), text);
	}
	git({ dir, env }, 'init', '--quiet');
	git({ dir, env }, 'add', '.');
	git({ dir, env }, 'commit', '--quiet', '--no-gpg-sign', '-m', 'init');
	if (opts.tag !== false) git({ dir, env }, 'tag', '--no-sign', '-a', '-m', `v${version}`, `v${version}`);
	return { dir, env };
}

function git(repo: Repo, ...args: string[]): string {
	return execFileSync('git', args, { cwd: repo.dir, env: repo.env, encoding: 'utf8' }).trim();
}

function edit(repo: Repo, rel: string, text: string): void {
	mkdirSync(dirname(join(repo.dir, rel)), { recursive: true });
	writeFileSync(join(repo.dir, rel), text);
	git(repo, 'add', '.');
	git(repo, 'commit', '--quiet', '--no-gpg-sign', '-m', `edit ${rel}`);
}

function bump(repo: Repo, ...args: string[]): { code: number; out: string } {
	let proc = spawnSync('node', [BIN, ...args], { cwd: repo.dir, env: repo.env, encoding: 'utf8' });
	return { code: proc.status ?? 1, out: proc.stdout + proc.stderr };
}

function version(repo: Repo, pkg: string): string {
	return JSON.parse(readFileSync(join(repo.dir, 'packages', pkg, 'package.json'), 'utf8')).version;
}

// A gpg program for git that signs anything, or fails when `fail` is set.
function gpg(dir: string, fail = false): string {
	let file = join(dir, '.home', 'gpg.sh');
	let body = fail
		? '#!/bin/sh\ncat > /dev/null\necho "gpg: signing failed" >&2\nexit 2\n'
		: '#!/bin/sh\ncat > /dev/null\nprintf "\\n[GNUPG:] SIG_CREATED D 1 8 00 0 FAKE\\n" >&2\nprintf -- "-----BEGIN PGP SIGNATURE-----\\n\\nfake\\n-----END PGP SIGNATURE-----\\n"\n';
	writeFileSync(file, body);
	chmodSync(file, 0o755);
	return file;
}

describe('bump <type>', () => {
	test('bumps a package that changed only in a subfolder, and commits and tags the release', () => {
		let r = repo({
			'packages/app/package.json': manifest('app', '1.0.0'),
			'packages/app/template/a.json': '{}',
			'packages/other/package.json': manifest('other', '1.0.0'),
		});
		edit(r, 'packages/app/template/a.json', '{ "b": 1 }');

		let { code, out } = bump(r, 'minor');
		expect({ code, out }).toMatchObject({ code: 0 });
		expect([version(r, 'app'), version(r, 'other')]).toEqual(['1.1.0', '1.0.0']);
		expect(JSON.parse(readFileSync(join(r.dir, 'bump.json'), 'utf8')).version).toBe('1.1.0');
		expect(git(r, 'log', '-1', '--format=%s')).toBe('v1.1.0');
		expect(git(r, 'cat-file', '-t', 'v1.1.0')).toBe('tag');
		expect(git(r, 'tag', '--list', '--format=%(contents:subject)', 'v1.1.0')).toBe('v1.1.0');
		expect(git(r, 'status', '--porcelain')).toBe('');
	});

	test('bumps the packages that depend on a changed one at runtime, and updates their ranges', () => {
		let r = repo({
			'packages/core/package.json': manifest('core', '1.0.0'),
			'packages/lib/package.json': manifest('lib', '1.0.0', { dependencies: { core: '^1.0.0' } }),
			'packages/app/package.json': manifest('app', '1.0.0', { peerDependencies: { lib: '~1.0.0' } }),
			'packages/tool/package.json': manifest('tool', '1.0.0', { devDependencies: { core: '^1.0.0' } }),
			'packages/ws/package.json': manifest('ws', '1.0.0', { dependencies: { core: 'workspace:*' } }),
		});
		edit(r, 'packages/core/index.js', 'export {}');

		expect(bump(r, 'major').code).toBe(0);
		let read = (pkg: string) => JSON.parse(readFileSync(join(r.dir, 'packages', pkg, 'package.json'), 'utf8'));
		expect(['core', 'lib', 'app', 'tool', 'ws'].map(pkg => read(pkg).version)).toEqual(['2.0.0', '2.0.0', '2.0.0', '1.0.0', '2.0.0']);
		expect(read('lib').dependencies).toEqual({ core: '^2.0.0' });
		expect(read('app').peerDependencies).toEqual({ lib: '~2.0.0' });
		expect(read('tool').devDependencies).toEqual({ core: '^2.0.0' });
		expect(read('ws').dependencies).toEqual({ core: 'workspace:*' });
		expect(git(r, 'status', '--porcelain')).toBe('');
	});

	test('--all, or "all" in bump.json, bumps every package', () => {
		let files = { 'packages/a/package.json': manifest('a', '1.0.0'), 'packages/b/package.json': manifest('b', '1.0.0') };
		let flag = repo(files);
		edit(flag, 'packages/a/x.js', '1');
		expect(bump(flag, 'patch', '--all').code).toBe(0);
		expect([version(flag, 'a'), version(flag, 'b')]).toEqual(['1.0.1', '1.0.1']);

		let config = repo({ ...files, 'bump.json': JSON.stringify({ version: '1.0.0', packages: ['packages'], all: true }) });
		edit(config, 'packages/a/x.js', '1');
		expect(bump(config, 'patch').code).toBe(0);
		expect([version(config, 'a'), version(config, 'b')]).toEqual(['1.0.1', '1.0.1']);
		expect(readFileSync(join(config.dir, 'bump.json'), 'utf8')).toBe(JSON.stringify({ version: '1.0.1', packages: ['packages'], all: true }));
	});

	test('keeps the indent and final newline of each file', () => {
		let tabs = '{\n\t"name": "a",\n\t"version": "1.0.0"\n}';
		let r = repo({ 'packages/a/package.json': tabs, 'bump.json': '{\n\t"version": "1.0.0"\n}\n' });
		edit(r, 'packages/a/x.js', '1');
		expect(bump(r, 'minor').code).toBe(0);
		expect(readFileSync(join(r.dir, 'packages/a/package.json'), 'utf8')).toBe(tabs.replace('1.0.0', '1.1.0'));
		expect(readFileSync(join(r.dir, 'bump.json'), 'utf8')).toBe('{\n\t"version": "1.1.0"\n}\n');
	});

	test('works from a subfolder of the repo', () => {
		let r = repo({ 'packages/a/package.json': manifest('a', '1.0.0'), 'packages/b/package.json': manifest('b', '1.0.0') });
		edit(r, 'packages/a/lib/x.js', '1');
		let { code } = bump(r, 'minor', '-C', join(r.dir, 'packages/b'));
		expect(code).toBe(0);
		expect([version(r, 'a'), version(r, 'b')]).toEqual(['1.1.0', '1.0.0']);
	});

	test('makes a signed tag when git signs tags', () => {
		let r = repo({ 'packages/a/package.json': manifest('a', '1.0.0') });
		edit(r, 'packages/a/x.js', '1');
		git(r, 'config', '--global', 'tag.gpgSign', 'true');
		git(r, 'config', '--global', 'gpg.program', gpg(r.dir));
		git(r, 'config', '--global', 'user.signingkey', 'FAKE');

		let { code, out } = bump(r, 'minor');
		expect({ code, out }).toMatchObject({ code: 0 });
		expect(git(r, 'cat-file', '-p', 'v1.1.0')).toContain('-----BEGIN PGP SIGNATURE-----');
	});

	test('a failed tag undoes the release commit and the version changes', () => {
		let r = repo({ 'packages/a/package.json': manifest('a', '1.0.0') });
		edit(r, 'packages/a/x.js', '1');
		let head = git(r, 'rev-parse', 'HEAD');
		git(r, 'config', '--global', 'tag.gpgSign', 'true');
		git(r, 'config', '--global', 'gpg.program', gpg(r.dir, true));
		git(r, 'config', '--global', 'user.signingkey', 'FAKE');

		let { code, out } = bump(r, 'minor');
		expect(code).toBe(1);
		expect(out).toContain('git tag');
		expect(git(r, 'rev-parse', 'HEAD')).toBe(head);
		expect(git(r, 'status', '--porcelain')).toBe('');
		expect(git(r, 'tag', '--list', 'v1.1.0')).toBe('');
		expect(version(r, 'a')).toBe('1.0.0');
	});

	test('refuses a tree with changes to tracked files, but --dryrun runs and writes nothing', () => {
		let r = repo({ 'packages/a/package.json': manifest('a', '1.0.0') });
		edit(r, 'packages/a/x.js', '1');
		writeFileSync(join(r.dir, 'packages/a/x.js'), '2');

		let refused = bump(r, 'minor');
		expect(refused.code).toBe(1);
		expect(refused.out).toContain('packages/a/x.js');

		let dry = bump(r, 'minor', '--dryrun');
		expect(dry.code).toBe(0);
		expect(dry.out).toContain('"a" (v1.0.0 ~> v1.1.0)');
		expect(version(r, 'a')).toBe('1.0.0');
		expect(git(r, 'status', '--porcelain')).toBe('M packages/a/x.js');
	});

	test('stops when nothing changed, when the last tag is missing, or when the next tag exists', () => {
		let r = repo({ 'packages/a/package.json': manifest('a', '1.0.0') });
		let none = bump(r, 'minor');
		expect([none.code, none.out]).toEqual([0, '! no changes since "1.0.0" version\n']);

		let untagged = repo({ 'packages/a/package.json': manifest('a', '1.0.0') }, { tag: false });
		expect(bump(untagged, 'minor').out).toContain('Missing "v1.0.0" tag');

		let taken = repo({ 'packages/a/package.json': manifest('a', '1.0.0') });
		edit(taken, 'packages/a/x.js', '1');
		git(taken, 'tag', '--no-sign', 'v1.1.0');
		expect(bump(taken, 'minor').out).toContain('The "v1.1.0" tag already exists');
	});

	test('a first release from 0.0.0 bumps every package without a tag', () => {
		let r = repo({ 'packages/a/package.json': manifest('a', '0.0.0'), 'packages/b/package.json': manifest('b', '0.0.0') }, { version: '0.0.0', tag: false });
		expect(bump(r, 'major').code).toBe(0);
		expect([version(r, 'a'), version(r, 'b')]).toEqual(['1.0.0', '1.0.0']);
	});
});
