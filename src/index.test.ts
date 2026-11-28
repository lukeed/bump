import { afterEach, beforeAll, describe, expect, test } from 'bun:test';

import * as h from './harness';

beforeAll(h.build);
afterEach(h.clean);

const ROOT = { 'package.json': h.manifest('root', undefined, { private: true, workspaces: ['packages/*'] }) };

let lockstep = (extra: Record<string, string> = {}, version = '1.0.0') => h.repo({
	...ROOT,
	'packages/a/package.json': h.manifest('a', version),
	'packages/b/package.json': h.manifest('b', version, { dependencies: { a: `^${version}` } }),
	'packages/c/package.json': h.manifest('c', version),
	...extra,
}, { tag: `v${version}` });

describe('lockstep', () => {
	test('releases every package when one changed, then commits and tags', () => {
		let r = lockstep();
		h.commit(r, { 'packages/a/lib/x.js': '1' });

		let run = h.bump(r, 'minor');
		expect(run).toMatchObject({ code: 0, stderr: '' });
		expect(['a', 'b', 'c'].map(name => h.version(r, `packages/${name}`))).toEqual(['1.1.0', '1.1.0', '1.1.0']);
		expect(JSON.parse(h.read(r, 'packages/b/package.json')).dependencies).toEqual({ a: '^1.1.0' });
		expect(h.git(r, 'log', '-1', '--format=%s')).toBe('v1.1.0');
		expect(h.git(r, 'cat-file', '-t', 'v1.1.0')).toBe('tag');
		expect(h.git(r, 'rev-parse', 'v1.1.0^{commit}')).toBe(h.git(r, 'rev-parse', 'HEAD'));
		expect(h.git(r, 'status', '--porcelain')).toBe('');

		let sha = h.git(r, 'rev-parse', '--short', 'HEAD');
		expect(run.stdout).toBe([
			'BUMP 1.0.0 → 1.1.0  (changed)',
			'     a, b, c',
			'EDIT b dependencies["a"] ^1.0.0 → ^1.1.0',
			`DONE Committed ${sha} v1.1.0`,
			'     Tagged v1.1.0',
			'',
		].join('\n'));
	});

	test('prints nothing to release without changes, and releases anyway with --all', () => {
		let r = lockstep();
		expect(h.bump(r, 'patch')).toMatchObject({ code: 0, stdout: 'DONE Nothing to release\n' });
		expect(h.bump(r, 'patch', '--all').code).toBe(0);
		expect(h.version(r, 'packages/c')).toBe('1.0.1');
	});

	test('ignores files outside every package', () => {
		let r = lockstep();
		h.commit(r, { 'docs/readme.md': 'x' });
		expect(h.bump(r, 'patch').stdout).toBe('DONE Nothing to release\n');
	});

	test('keeps the format of each manifest', () => {
		let text = '{\r\n\t"name": "a",\r\n\t"version": "1.0.0"\r\n}';
		let r = h.repo({ ...ROOT, 'packages/a/package.json': text }, { tag: 'v1.0.0' });
		h.commit(r, { 'packages/a/x.js': '1' });
		expect(h.bump(r, 'minor').code).toBe(0);
		expect(h.read(r, 'packages/a/package.json')).toBe(text.replace('1.0.0', '1.1.0'));
	});

	test('works from a subfolder, and finds bump.json up to the git top level', () => {
		let r = lockstep({ 'bump.json': '{ "packages": ["packages/*"] }' });
		h.commit(r, { 'packages/a/x.js': '1' });
		expect(h.bump(r, 'minor', '-C', 'packages/b').code).toBe(0);
		expect(h.version(r, 'packages/c')).toBe('1.1.0');
	});

	test('a first release from 0.0.0 needs no tag', () => {
		let r = h.repo({ ...ROOT, 'packages/a/package.json': h.manifest('a', '0.0.0'), 'packages/b/package.json': h.manifest('b', '0.0.0') });
		let run = h.bump(r, 'major');
		expect(run.code).toBe(0);
		expect(run.stdout).toStartWith('BUMP 0.0.0 → 1.0.0  (first)\n');
		expect(h.version(r, 'packages/b')).toBe('1.0.0');
	});

	test('releases an exact version', () => {
		let r = lockstep();
		h.commit(r, { 'packages/a/x.js': '1' });
		expect(h.bump(r, '2.0.0-rc.0').code).toBe(0);
		expect(h.version(r, 'packages/a')).toBe('2.0.0-rc.0');
		h.commit(r, { 'packages/a/x.js': '2' });
		expect(h.bump(r, '1.5.0').stderr).toBe('FAIL The next version of "(lockstep)" must be greater than 2.0.0-rc.0, but is 1.5.0\n');
	});

	test('refuses members with different versions', () => {
		let r = h.repo({ ...ROOT, 'packages/a/package.json': h.manifest('a', '1.0.0'), 'packages/b/package.json': h.manifest('b', '1.1.0') }, { tag: 'v1.0.0' });
		expect(h.bump(r, 'patch').stderr).toBe('FAIL The members of the release must share one version:\n│    a  1.0.0\n│    b  1.1.0\n');
	});

	test('does not release packages without a version, but updates their ranges', () => {
		let r = lockstep({ 'packages/site/package.json': h.manifest('site', undefined, { private: true, devDependencies: { a: '^1.0.0' } }) });
		h.commit(r, { 'packages/a/x.js': '1' });
		expect(h.bump(r, 'minor').code).toBe(0);
		expect(JSON.parse(h.read(r, 'packages/site/package.json'))).toEqual({ name: 'site', private: true, devDependencies: { a: '^1.1.0' } });
	});
});

describe('anchors', () => {
	test('refuses a manifest without its tag, and lists both ways out', () => {
		let r = lockstep({}, '1.4.0');
		h.git(r, 'tag', '-d', 'v1.4.0');
		let run = h.bump(r, 'minor');
		expect(run.code).toBe(1);
		expect(run.stderr).toBe([
			'FAIL No tag found for 1 unit whose manifest is past 0.0.0',
			'│    (lockstep)   manifest 1.4.0   expected tag v1.4.0',
			'│',
			'│    To continue from the last release, tag the commit that released it:',
			'│      git tag -a v1.4.0 -m v1.4.0 <commit>',
			'│',
			'│    To use the manifest version as the base, run again with --adopt:',
			'│      bump minor --adopt   →   1.5.0',
			'',
		].join('\n'));

		let adopted = h.bump(r, 'minor', '--adopt');
		expect(adopted.code).toBe(0);
		expect(adopted.stdout).toStartWith('BUMP 1.4.0 → 1.5.0  (adopted)\n');
	});

	test('refuses a manifest behind a reachable release', () => {
		let r = lockstep();
		h.tag(r, 'v1.1.0');
		expect(h.bump(r, 'patch').stderr).toBe('FAIL "v1.1.0" is released, but the manifest says 1.0.0\n');
	});

	test('refuses an anchor that is not in the history of HEAD', () => {
		let r = lockstep();
		h.git(r, 'tag', '-d', 'v1.0.0');
		h.git(r, 'switch', '--quiet', '-c', 'side');
		h.commit(r, { 'x.txt': '1' });
		h.tag(r, 'v1.0.0');
		h.git(r, 'switch', '--quiet', 'main');
		expect(h.bump(r, 'patch').stderr).toBe('FAIL The "v1.0.0" release commit is not in the history of HEAD; merge it first\n');
	});

	test('ignores higher tags on other branches', () => {
		let r = lockstep();
		h.git(r, 'switch', '--quiet', '-c', 'next');
		h.commit(r, { 'packages/a/x.js': '1' });
		h.tag(r, 'v2.0.0');
		h.git(r, 'switch', '--quiet', 'main');
		h.commit(r, { 'packages/a/y.js': '1' });
		expect(h.bump(r, 'patch').code).toBe(0);
		expect(h.version(r, 'packages/a')).toBe('1.0.1');
	});

	test('refuses a shallow clone', () => {
		let r = lockstep();
		h.commit(r, { 'packages/a/x.js': '1' });
		let clone = { ...r, dir: `${r.dir}/.home/clone` };
		h.git(r, 'clone', '--quiet', '--depth', '1', `file://${r.dir}`, clone.dir);
		expect(h.bump(clone, 'patch').stderr).toStartWith('FAIL A full clone is needed');
	});

	test('refuses a repository without commits', () => {
		let r = h.repo({});
		h.git(r, 'update-ref', '-d', 'HEAD');
		expect(h.bump(r, 'patch').stderr).toBe('FAIL The repository has no commits\n');
	});
});

describe('change detection', () => {
	test('ignores a change that only a release commit made', () => {
		let r = h.repo({
			'bump.json': '{ "independent": true, "packages": "packages/*" }',
			'packages/a/package.json': h.manifest('a', '1.0.0'),
			'packages/tool/package.json': h.manifest('tool', '1.0.0', { devDependencies: { a: '^1.0.0' } }),
		});
		h.tag(r, 'a@1.0.0');
		h.tag(r, 'tool@1.0.0');
		h.commit(r, { 'packages/a/x.js': '1' });
		expect(h.bump(r, 'minor').code).toBe(0);
		expect(h.version(r, 'packages/tool')).toBe('1.0.0');
		expect(JSON.parse(h.read(r, 'packages/tool/package.json')).devDependencies).toEqual({ a: '^1.1.0' });
		expect(h.bump(r, 'minor').stdout).toBe('DONE Nothing to release\n');
	});

	test('counts a change in a nested package for the nested package only', () => {
		let r = h.repo({
			'bump.json': '{ "independent": true, "packages": [".", "inner"] }',
			'package.json': h.manifest('outer', '1.0.0'),
			'inner/package.json': h.manifest('inner', '1.0.0'),
		});
		h.tag(r, 'outer@1.0.0');
		h.tag(r, 'inner@1.0.0');
		h.commit(r, { 'inner/é.js': '1' });
		let run = h.bump(r, 'patch');
		expect(run.code).toBe(0);
		expect([h.version(r, '.'), h.version(r, 'inner')]).toEqual(['1.0.0', '1.0.1']);
	});

	test('counts a change that only a merge commit made', () => {
		let r = h.repo({ 'bump.json': '{ "independent": true, "packages": "packages/*" }', 'packages/a/package.json': h.manifest('a', '1.0.0') }, { tag: 'a@1.0.0' });
		h.git(r, 'switch', '--quiet', '-c', 'side');
		h.commit(r, { 'docs/q.txt': '1' });
		h.git(r, 'switch', '--quiet', 'main');
		h.git(r, 'merge', '--quiet', '--no-ff', '--no-commit', 'side');
		h.commit(r, { 'packages/a/z.js': '1' }, 'merge');
		expect(h.git(r, 'rev-list', '--no-merges', 'a@1.0.0..HEAD', '--', 'packages')).toBe('');
		expect(h.bump(r, 'patch').code).toBe(0);
		expect(h.version(r, 'packages/a')).toBe('1.0.1');
	});
});

describe('git', () => {
	test('makes signed tags when git signs tags', () => {
		let r = lockstep();
		h.commit(r, { 'packages/a/x.js': '1' });
		h.sign(r);
		expect(h.bump(r, 'minor').code).toBe(0);
		expect(h.git(r, 'cat-file', '-p', 'v1.1.0')).toContain('-----BEGIN PGP SIGNATURE-----');
	});

	test('a failed tag undoes the commit and the files', () => {
		let r = lockstep();
		h.commit(r, { 'packages/a/x.js': '1' });
		let head = h.git(r, 'rev-parse', 'HEAD');
		h.sign(r, true);
		let run = h.bump(r, 'minor');
		expect(run.code).toBe(1);
		expect(run.stderr).toBe('FAIL Could not create tag "v1.1.0": gpg failed to sign the data\n│    The release was undone: no files, commits, or tags changed.\n');
		expect(h.git(r, 'rev-parse', 'HEAD')).toBe(head);
		expect(h.git(r, 'status', '--porcelain')).toBe('');
		expect(h.git(r, 'tag', '--list')).toBe('v1.0.0');
	});

	test('a failed later tag deletes the earlier tags', () => {
		let r = h.repo({ 'bump.json': '{ "independent": true, "packages": "packages/*" }', 'packages/a/package.json': h.manifest('a', '1.0.0'), 'packages/b/package.json': h.manifest('b', '1.0.0') });
		h.tag(r, 'a@1.0.0');
		h.tag(r, 'b@1.0.0');
		h.commit(r, { 'packages/a/x.js': '1', 'packages/b/x.js': '1' });
		let head = h.git(r, 'rev-parse', 'HEAD');
		h.write(r, { '.git/hooks/reference-transaction': '#!/bin/sh\n[ "$1" = prepared ] && grep -q "refs/tags/b@" && exit 1\nexit 0\n' });
		Bun.spawnSync(['chmod', '+x', `${r.dir}/.git/hooks/reference-transaction`]);
		let run = h.bump(r, 'minor');
		expect(run.code).toBe(1);
		expect(h.git(r, 'rev-parse', 'HEAD')).toBe(head);
		expect(h.git(r, 'tag', '--list').split('\n')).toEqual(['a@1.0.0', 'b@1.0.0']);
		expect(h.git(r, 'status', '--porcelain')).toBe('');
	});

	test('a post-commit hook that moves HEAD does not move the tags', () => {
		let r = lockstep();
		h.commit(r, { 'packages/a/x.js': '1' });
		h.write(r, { '.git/hooks/post-commit': '#!/bin/sh\n[ -f .home/done ] && exit 0\ntouch .home/done\ngit commit --quiet --no-gpg-sign --allow-empty -m extra\n' });
		Bun.spawnSync(['chmod', '+x', `${r.dir}/.git/hooks/post-commit`]);
		expect(h.bump(r, 'minor').code).toBe(0);
		expect(h.git(r, 'log', '-1', '--format=%s', 'v1.1.0')).toBe('v1.1.0');
	});

	test('a failing pre-commit hook undoes the files', () => {
		let r = lockstep();
		h.commit(r, { 'packages/a/x.js': '1' });
		h.write(r, { '.git/hooks/pre-commit': '#!/bin/sh\necho nope >&2\nexit 1\n' });
		Bun.spawnSync(['chmod', '+x', `${r.dir}/.git/hooks/pre-commit`]);
		let run = h.bump(r, 'minor');
		expect(run.code).toBe(1);
		expect(run.stderr).toContain('nope');
		expect(h.git(r, 'status', '--porcelain')).toBe('');
		expect(h.version(r, 'packages/a')).toBe('1.0.0');
	});

	test('refuses a dirty tree, but a dry run warns and writes nothing', () => {
		let r = lockstep();
		h.commit(r, { 'packages/a/x.js': '1' });
		h.write(r, { 'packages/a/x.js': '2' });
		expect(h.bump(r, 'minor').stderr).toBe('FAIL Commit or stash the changes to tracked files first:\n│    M packages/a/x.js\n');

		let dry = h.bump(r, 'minor', '--dryrun');
		expect(dry.code).toBe(0);
		expect(dry.stderr).toBe('WARN A release needs a clean tree; these tracked files have changes:\n│    M packages/a/x.js\n');
		expect(dry.stdout).toEndWith('DONE Dry run; no files were written\n');
		expect(h.version(r, 'packages/a')).toBe('1.0.0');
		expect(h.git(r, 'tag', '--list')).toBe('v1.0.0');
	});

	test('refuses a merge in progress', () => {
		let r = lockstep();
		h.commit(r, { 'packages/a/x.js': '1' });
		h.write(r, { '.git/MERGE_HEAD': h.git(r, 'rev-parse', 'HEAD') + '\n' });
		expect(h.bump(r, 'minor').stderr).toBe('FAIL A merge is in progress; finish it first\n');
	});

	test('refuses an existing tag', () => {
		let r = lockstep();
		h.commit(r, { 'packages/a/x.js': '1' });
		h.git(r, 'tag', 'v1.1.0', 'HEAD~1');
		h.git(r, 'tag', '-d', 'v1.1.0');
		h.git(r, 'switch', '--quiet', '-c', 'other');
		h.commit(r, { 'y.txt': '1' });
		h.tag(r, 'v1.1.0');
		h.git(r, 'switch', '--quiet', 'main');
		expect(h.bump(r, 'minor').stderr).toBe('FAIL These tags already exist: "v1.1.0"\n');
	});

	test('refuses an untracked manifest', () => {
		let r = lockstep();
		h.commit(r, { 'packages/a/x.js': '1' });
		h.write(r, { 'packages/d/package.json': h.manifest('d', '1.0.0') });
		expect(h.bump(r, 'minor').stderr).toBe('FAIL These files are not tracked by git: "packages/d/package.json"\n');
	});

	test('works on a detached HEAD', () => {
		let r = lockstep();
		h.commit(r, { 'packages/a/x.js': '1' });
		h.git(r, 'switch', '--quiet', '--detach');
		expect(h.bump(r, 'minor').code).toBe(0);
	});

	test('refuses a tag name that git does not allow', () => {
		let r = h.repo({ 'bump.json': '{ "packages": "packages/*", "tag": "v {version}" }', 'packages/a/package.json': h.manifest('a', '0.0.0') });
		expect(h.bump(r, 'patch').stderr).toBe('FAIL Invalid tag name: "v 0.0.1"\n');
	});
});

describe('ownership and formats', () => {
	test('two packages in one folder both own its files, and a root package owns the rest', () => {
		let r = h.repo({
			'bump.json': JSON.stringify({ independent: true, packages: ['.', 'twin', 'deep'] }),
			'package.json': h.manifest('root', '1.0.0'),
			'twin/package.json': h.manifest('twin-js', '1.0.0'),
			'twin/Cargo.toml': h.crate('twin-rs', '1.0.0'),
			'deep/package.json': h.manifest('deep', '1.0.0'),
		});
		for (let name of ['root', 'twin-js', 'twin-rs', 'deep']) h.tag(r, `${name}@1.0.0`);
		h.commit(r, { 'twin/src/lib.rs': '', 'docs/x.md': '' });
		let names = JSON.parse(h.bump(r, 'patch', '--json').stdout).units.map((unit: { name: string }) => unit.name);
		expect(names).toEqual(['root', 'twin-js', 'twin-rs']);
	});

	test('keeps a byte order mark in package.json', () => {
		let text = '\ufeff' + h.manifest('a', '1.0.0');
		let r = h.repo({ ...ROOT, 'packages/a/package.json': text }, { tag: 'v1.0.0' });
		h.commit(r, { 'packages/a/x.js': '1' });
		expect(h.bump(r, 'patch').code).toBe(0);
		expect(h.read(r, 'packages/a/package.json')).toBe(text.replace('1.0.0', '1.0.1'));
	});

	test('releases a package.json with comments, as Bun allows', () => {
		let text = '{\n\t// shared helpers\n\t"name": "a",\n\t"version": "1.0.0",\n}\n';
		let r = h.repo({ ...ROOT, 'packages/a/package.json': text }, { tag: 'v1.0.0' });
		h.commit(r, { 'packages/a/x.js': '1' });
		expect(h.bump(r, 'patch').code).toBe(0);
		expect(h.read(r, 'packages/a/package.json')).toBe(text.replace('1.0.0', '1.0.1'));
	});

	test('a single package prints no member line', () => {
		let r = h.repo({ 'package.json': h.manifest('solo', '1.0.0') }, { tag: 'v1.0.0' });
		h.commit(r, { 'x.js': '1' });
		let sha = () => h.git(r, 'rev-parse', '--short', 'HEAD');
		let run = h.bump(r, 'patch');
		expect(run.stdout).toBe(`BUMP 1.0.0 → 1.0.1  (changed)\nDONE Committed ${sha()} v1.0.1\n     Tagged v1.0.1\n`);
	});
});
