import { afterEach, beforeAll, describe, expect, test } from 'bun:test';

import * as h from './harness';

beforeAll(h.build);
afterEach(h.clean);

let config = (extra: object = {}) => JSON.stringify({ independent: true, packages: ['packages/*'], ...extra }) + '\n';

let independent = (packages: Record<string, [string, object?]>, extra: object = {}) => {
	let files: Record<string, string> = { 'bump.json': config(extra) };
	for (let [name, [version, fields]] of Object.entries(packages)) files[`packages/${name}/package.json`] = h.manifest(name, version, fields);
	let r = h.repo(files);
	for (let [name, [version]] of Object.entries(packages)) h.tag(r, `${name}@${version}`);
	return r;
};

let versions = (r: h.Repo, ...names: string[]) => names.map(name => h.version(r, `packages/${name}`));

describe('independent', () => {
	test('releases changed units with the type, and their dependents with a patch', () => {
		let r = independent({
			core: ['1.2.0'],
			lib: ['0.4.1', { dependencies: { core: '^1.2.0' } }],
			app: ['3.0.0', { peerDependencies: { lib: '~0.4.1' } }],
			tool: ['2.0.0', { devDependencies: { core: '^1.2.0' } }],
			other: ['5.0.0'],
		});
		h.commit(r, { 'packages/core/x.js': '1' });

		let run = h.bump(r, 'minor');
		expect(run.code).toBe(0);
		expect(versions(r, 'core', 'lib', 'app', 'tool', 'other')).toEqual(['1.3.0', '0.4.2', '3.0.1', '2.0.0', '5.0.0']);
		expect(JSON.parse(h.read(r, 'packages/app/package.json')).peerDependencies).toEqual({ lib: '~0.4.2' });
		expect(JSON.parse(h.read(r, 'packages/tool/package.json')).devDependencies).toEqual({ core: '^1.3.0' });
		expect(h.git(r, 'log', '-1', '--format=%s')).toBe('release: core@1.3.0, lib@0.4.2, app@3.0.1');
		expect(h.git(r, 'tag', '--points-at', 'HEAD').split('\n')).toEqual(['app@3.0.1', 'core@1.3.0', 'lib@0.4.2']);
		expect(run.stdout.split('\n').slice(0, 3)).toEqual([
			'~> core 1.2.0 → 1.3.0 (changed)',
			'~> lib 0.4.1 → 0.4.2 (dependent)',
			'~> app 3.0.0 → 3.0.1 (dependent)',
		]);
	});

	test('a target releases even when unchanged, and leaves other changes alone', () => {
		let r = independent({ a: ['1.0.0'], b: ['1.0.0', { dependencies: { a: 'workspace:*' } }], c: ['1.0.0'] });
		h.commit(r, { 'packages/c/x.js': '1' });
		let run = h.bump(r, 'major', 'a');
		expect(run.code).toBe(0);
		expect(versions(r, 'a', 'b', 'c')).toEqual(['2.0.0', '1.0.1', '1.0.0']);
		expect(run.stdout).toStartWith('~> a 1.0.0 → 2.0.0 (target)\n~> b 1.0.0 → 1.0.1 (dependent)\n');
	});

	test('targets need a known name, and a versioned package', () => {
		let r = independent({ a: ['1.0.0'] });
		h.commit(r, { 'packages/site/package.json': h.manifest('site', undefined) });
		expect(h.bump(r, 'patch', 'x', 'y').stderr).toBe('error: Unknown targets: "x", "y"\n');
		expect(h.bump(r, 'patch', 'site').stderr).toBe('error: Package "site" has no version, so it cannot be a target\n');
		expect(h.bump(r, 'patch', 'a', '--all').stderr).toBe('error: Cannot combine --all with targets\n');
	});

	test('an unrelated unit without a tag does not block a target', () => {
		let r = independent({ a: ['1.0.0'], b: ['1.0.0'] });
		h.git(r, 'tag', '-d', 'b@1.0.0');
		expect(h.bump(r, 'patch', 'a').code).toBe(0);
		expect(h.bump(r, 'patch').stderr).toStartWith('error: no tag found for 1 unit');
	});

	test('the no-tag error lists every unit and the --adopt result', () => {
		let r = independent({ app: ['3.4.0'], api: ['1.1.0', { dependencies: { app: '^3.4.0' } }] });
		h.git(r, 'tag', '-d', 'app@3.4.0');
		h.git(r, 'tag', '-d', 'api@1.1.0');
		let run = h.bump(r, 'minor');
		expect(run.stderr).toBe([
			'error: no tag found for 2 units whose manifests are past 0.0.0',
			'',
			'  app   manifest 3.4.0   expected tag app@3.4.0',
			'  api   manifest 1.1.0   expected tag api@1.1.0',
			'',
			'To continue from the last release, tag the commit that released it:',
			'  git tag -a app@3.4.0 -m app@3.4.0 <commit>',
			'  git tag -a api@1.1.0 -m api@1.1.0 <commit>',
			'',
			'To use the manifest versions as the base, run again with --adopt:',
			'  bump minor --adopt   →   app 3.5.0, api 1.2.0',
			'',
		].join('\n'));
		expect(h.bump(r, 'minor', '--adopt').code).toBe(0);
		expect(versions(r, 'app', 'api')).toEqual(['3.5.0', '1.2.0']);
	});

	test('a cycle of dependents releases each unit once, in name order', () => {
		let r = independent({
			core: ['1.0.0'],
			x: ['1.0.0', { dependencies: { core: '1.0.0', y: '1.0.0' } }],
			y: ['1.0.0', { dependencies: { x: '1.0.0' } }],
		});
		h.commit(r, { 'packages/core/x.js': '1' });
		let run = h.bump(r, 'preminor');
		expect(run.code).toBe(0);
		expect(versions(r, 'core', 'x', 'y')).toEqual(['1.1.0-next.0', '1.0.1-next.0', '1.0.1-next.0']);
		expect(h.git(r, 'log', '-1', '--format=%s')).toBe('release: core@1.1.0-next.0, x@1.0.1-next.0, y@1.0.1-next.0');
	});
});

describe('dependents of prereleases', () => {
	test('a stable dependent gets a prerelease with the preid of its trigger', () => {
		let r = independent({ app: ['1.2.0'], cli: ['0.4.1', { dependencies: { app: '^1.2.0' } }] });
		expect(h.bump(r, '2.0.0-rc.0', 'app').code).toBe(0);
		expect(versions(r, 'app', 'cli')).toEqual(['2.0.0-rc.0', '0.4.2-rc.0']);
		expect(JSON.parse(h.read(r, 'packages/cli/package.json')).dependencies).toEqual({ app: '^2.0.0-rc.0' });
	});

	test('a prerelease dependent continues its own preid', () => {
		let r = independent({ app: ['1.3.0-next.0'], cli: ['0.4.2-beta.0', { dependencies: { app: '1.3.0-next.0' } }] });
		h.commit(r, { 'packages/app/x.js': '1' });
		expect(h.bump(r, 'prerelease').code).toBe(0);
		expect(versions(r, 'app', 'cli')).toEqual(['1.3.0-next.1', '0.4.2-beta.1']);
	});

	test('a stable trigger keeps a stable dependent stable, and --preid applies only to seeds', () => {
		let r = independent({ app: ['1.2.0'], cli: ['0.4.1', { dependencies: { app: '^1.2.0' } }] }, { preid: 'alpha' });
		h.commit(r, { 'packages/app/x.js': '1' });
		expect(h.bump(r, 'preminor', '--preid', 'rc', '--dryrun', '--json').stdout).toContain('"to": "0.4.2-rc.0"');
		expect(h.bump(r, 'preminor', '--dryrun', '--json').stdout).toContain('"to": "0.4.2-alpha.0"');
		expect(h.bump(r, 'minor').code).toBe(0);
		expect(versions(r, 'app', 'cli')).toEqual(['1.3.0', '0.4.2']);
	});

	test('a dependent through another prerelease dependent is a prerelease too', () => {
		let r = independent({
			core: ['1.0.0'],
			mid: ['2.0.0-beta.1', { dependencies: { core: '^1.0.0' } }],
			top: ['3.0.0', { dependencies: { mid: '2.0.0-beta.1' } }],
		});
		h.commit(r, { 'packages/core/x.js': '1' });
		expect(h.bump(r, 'patch').code).toBe(0);
		expect(versions(r, 'core', 'mid', 'top')).toEqual(['1.0.1', '2.0.0-beta.2', '3.0.1-beta.0']);
	});

	test('a dependent prerelease of another form asks for a target', () => {
		let r = independent({ app: ['1.0.0'], cli: ['1.0.0-0', { dependencies: { app: '^1.0.0' } }] });
		h.commit(r, { 'packages/app/x.js': '1' });
		expect(h.bump(r, 'patch').stderr).toBe('error: Cannot continue the "1.0.0-0" prerelease of "cli"; release it as a target with an exact version first\n');
	});
});

describe('groups', () => {
	test('a group releases densely with one tag, and a member target selects it', () => {
		let r = independent({ ui: ['1.2.0'], web: ['1.2.0', { dependencies: { ui: '^1.2.0' } }], api: ['1.0.0'] }, { groups: { site: ['ui', 'web'] } });
		h.git(r, 'tag', '-d', 'ui@1.2.0');
		h.git(r, 'tag', '-d', 'web@1.2.0');
		h.tag(r, 'site@1.2.0');
		h.commit(r, { 'packages/ui/x.js': '1' });

		let run = h.bump(r, 'minor', 'ui');
		expect(run.code).toBe(0);
		expect(versions(r, 'ui', 'web', 'api')).toEqual(['1.3.0', '1.3.0', '1.0.0']);
		expect(h.git(r, 'tag', '--points-at', 'HEAD')).toBe('site@1.3.0');
		expect(run.stdout).toStartWith('~> site 1.2.0 → 1.3.0 (target)\n     ui, web\n');
	});

	test('refuses invalid groups', () => {
		let r = independent({ a: ['1.0.0'], b: ['1.0.0'] });
		let run = (groups: object) => {
			h.write(r, { 'bump.json': config({ groups }) });
			return h.bump(r, 'patch', '--dryrun').stderr;
		};
		expect(run({ g: ['x'] })).toBe('error: Unknown package "x" in group "g"\n');
		expect(run({ g: ['a'], h: ['a'] })).toBe('error: Package "a" is in groups "g" and "h"\n');
		expect(run({ b: ['a'] })).toBe('error: Group "b" has the name of a package that is not its member\n');
		expect(run({ a: ['a', 'b'] })).toBe('');
	});
});

describe('json', () => {
	test('prints the result on stdout and the log on stderr', () => {
		let r = independent({ core: ['1.2.0'], cli: ['0.4.1', { dependencies: { core: '^1.2.0' } }] });
		h.commit(r, { 'packages/core/x.js': '1' });
		let run = h.bump(r, 'minor', '--json');
		expect(run.code).toBe(0);
		let result = JSON.parse(run.stdout);
		expect(result).toEqual({
			dryrun: false,
			type: 'minor',
			commit: h.git(r, 'rev-parse', 'HEAD'),
			message: 'release: core@1.3.0, cli@0.4.2',
			units: [
				{ name: 'core', type: 'minor', tag: 'core@1.3.0', from: '1.2.0', to: '1.3.0', reason: 'changed', packages: [{ name: 'core', ecosystem: 'npm', dir: 'packages/core', publish: true }] },
				{ name: 'cli', type: 'patch', tag: 'cli@0.4.2', from: '0.4.1', to: '0.4.2', reason: 'dependent', packages: [{ name: 'cli', ecosystem: 'npm', dir: 'packages/cli', publish: true }] },
			],
			ranges: [{ file: 'packages/cli/package.json', package: 'cli', dependency: 'core', field: 'dependencies', from: '^1.2.0', to: '^1.3.0' }],
			files: ['packages/cli/package.json', 'packages/core/package.json'],
		});
		expect(run.stderr).toContain('~> core 1.2.0 → 1.3.0 (changed)');
	});

	test('nothing to release, and a dry run', () => {
		let r = independent({ a: ['1.0.0', { private: true }] });
		expect(JSON.parse(h.bump(r, 'patch', '--json').stdout)).toEqual({ dryrun: false, type: 'patch', commit: null, message: null, units: [], ranges: [], files: [] });

		h.commit(r, { 'packages/a/x.js': '1' });
		let dry = JSON.parse(h.bump(r, '2.0.0', '--json', '--dryrun').stdout);
		expect(dry).toMatchObject({ dryrun: true, type: 'exact', commit: null, message: 'release: a@2.0.0', files: ['packages/a/package.json'] });
		expect(dry.units[0].packages[0].publish).toBe(false);
	});
});
