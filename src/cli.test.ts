import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, test } from 'bun:test';

import pkg from '../package.json' with { type: 'json' };

import * as h from './harness';

beforeAll(h.build);
afterEach(h.clean);

let lockstep = () => {
	let r = h.repo({
		'package.json': h.manifest('root', undefined, { private: true, workspaces: ['packages/*'] }),
		'packages/a/package.json': h.manifest('a', '1.0.0'),
	}, { tag: 'v1.0.0' });
	h.commit(r, { 'packages/a/x.js': '1' });
	return r;
};

describe('cli', () => {
	test('--help wins over everything, then --version', () => {
		let r = h.repo({});
		let help = h.bump(r, 'nope', '--bad', '-v', '--help');
		expect(help).toMatchObject({ code: 0, stderr: '' });
		expect(help.stdout).toStartWith('\n  Usage\n    bump <type | version> [...targets] [options]\n');
		expect(h.bump(r, '-h').stdout).toBe(help.stdout);
		expect(h.bump(r, '--bad', '--version')).toMatchObject({ code: 0, stdout: `bump, v${pkg.version}\n` });
	});

	test('refuses unknown options, missing values, and bad positionals', () => {
		let r = h.repo({});
		let cases: [string[], string][] = [
			[['patch', '--nope'], 'Unknown option "--nope"'],
			[['patch', '-x'], 'Unknown option "-x"'],
			[['patch', '--preid'], 'Missing value for --preid'],
			[['patch', '-C'], 'Missing value for --cwd'],
			[[], 'Missing <type> argument'],
			[['huge'], 'Invalid <type> argument: "huge"'],
			[['1.0'], 'Invalid <type> argument: "1.0"'],
			[['v1.0.0'], 'Invalid <type> argument: "v1.0.0"'],
			[['1.0.0+build'], 'Invalid <type> argument: "1.0.0+build"'],
			[['patch', '--preid', 'rc'], 'Cannot use --preid with "patch"'],
			[['2.0.0', '--preid', 'rc'], 'Cannot use --preid with "2.0.0"'],
			[['prepatch', '--preid', '7'], 'Invalid --preid value: "7"'],
			[['patch', 'a', '-A'], 'Cannot combine --all with targets'],
			[['patch', 'a'], 'Targets need "independent": true in bump.json'],
		];
		for (let [args, message] of cases) {
			expect(h.bump(r, ...args)).toEqual({ code: 1, stdout: '', stderr: `error: ${message}\n` });
		}
	});

	test('accepts a type in any case, and --cwd', () => {
		let r = lockstep();
		let other = h.repo({});
		expect(h.bump(other, 'MINOR', '-C', r.dir).code).toBe(0);
		expect(h.version(r, 'packages/a')).toBe('1.1.0');
	});

	test('SIGINT during the release undoes it, and exits 130', async () => {
		let r = lockstep();
		let head = h.git(r, 'rev-parse', 'HEAD');
		h.write(r, { '.git/hooks/pre-commit': '#!/bin/sh\ntouch .home/waiting\nsleep 5\n' });
		Bun.spawnSync(['chmod', '+x', join(r.dir, '.git/hooks/pre-commit')]);

		let proc = Bun.spawn(['bun', join(import.meta.dirname, '..', 'bin.js'), 'minor'], { cwd: r.dir, env: r.env, stderr: 'pipe' });
		while (!(await Bun.file(join(r.dir, '.home/waiting')).exists())) await Bun.sleep(20);
		proc.kill('SIGINT');

		expect(await proc.exited).toBe(130);
		expect(await new Response(proc.stderr).text()).toBe('error: Stopped by SIGINT; the release was undone\n');
		expect(h.git(r, 'rev-parse', 'HEAD')).toBe(head);
		expect(h.git(r, 'status', '--porcelain')).toBe('');
		expect(h.git(r, 'tag', '--list')).toBe('v1.0.0');
	}, 20_000);
});
