import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

/** A git command that exited with an error, with its stderr. */
export class Failure extends Error {
	stderr: string;

	constructor(args: string[], stderr: string, code: number) {
		super(`\`git ${args.join(' ')}\` failed: ${stderr.trim() || `exit code ${code}`}`);
		this.stderr = stderr;
	}
}

/**
 * Run `git` with `args` in `cwd`, and return its stdout, untouched.
 * @example await raw('repo', ['diff', '-z', '--name-only', 'v1.0.0', 'HEAD'])
 */
export async function raw(cwd: string, args: string[], input?: string): Promise<string> {
	try {
		var proc = Bun.spawn(['git', ...args], {
			cwd,
			stdin: input === undefined ? 'ignore' : new Blob([input]),
			stdout: 'pipe',
			stderr: 'pipe',
		});
	} catch (err) {
		if (Reflect.get(Object(err), 'code') === 'ENOENT') throw new Error('Missing "git" binary');
		throw err;
	}
	let [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (code !== 0) throw new Failure(args, stderr, code);
	return stdout;
}

/**
 * Run `git` with `args` in `cwd`, and return its stdout, trimmed.
 * @example await run('repo', ['rev-parse', 'HEAD']) //=> 'a1b2c3…'
 */
export async function run(cwd: string, args: string[], input?: string): Promise<string> {
	return (await raw(cwd, args, input)).trim();
}

/**
 * Whether `git` succeeds with `args` in `cwd`.
 * @example await ok('repo', ['ls-files', '--error-unmatch', 'Cargo.lock']) //=> true
 */
export async function ok(cwd: string, args: string[]): Promise<boolean> {
	return raw(cwd, args).then(() => true, () => false);
}

function split(output: string, separator: string): string[] {
	return output.split(separator).filter(Boolean);
}

/**
 * The real path of the top level of the repository that `cwd` is in.
 * @example await top('repo/packages/a') //=> '/home/me/repo'
 */
export async function top(cwd: string): Promise<string> {
	try {
		var dir = await run(cwd, ['rev-parse', '--show-toplevel']);
	} catch (err) {
		if (err instanceof Error && err.message === 'Missing "git" binary') throw err;
		throw new Error(`Not a git repository: "${cwd}"`);
	}
	return realpathSync(dir);
}

/**
 * The full SHA of HEAD, or `undefined` when HEAD has no commit.
 * @example await head('repo') //=> 'a1b2c3…'
 */
export async function head(cwd: string): Promise<string | undefined> {
	return run(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']).catch(() => undefined);
}

/**
 * Whether the repository is a shallow clone.
 * @example await shallow('repo') //=> false
 */
export async function shallow(cwd: string): Promise<boolean> {
	return (await run(cwd, ['rev-parse', '--is-shallow-repository'])) === 'true';
}

/**
 * The tag names of the repository, or only those reachable from HEAD.
 * @example await tags('repo', true) //=> ['v1.0.0']
 */
export async function tags(cwd: string, reachable = false): Promise<string[]> {
	return split(await run(cwd, reachable ? ['tag', '--merged', 'HEAD'] : ['tag', '--list']), '\n');
}

/**
 * Each tag name with the SHA of the commit it points to.
 * @example await targets('repo') //=> Map { 'v1.0.0' => 'a1b2c3…' }
 */
export async function targets(cwd: string): Promise<Map<string, string>> {
	let output = await run(cwd, ['for-each-ref', '--format=%(refname:short)%00%(objectname)%00%(*objectname)', 'refs/tags']);
	let map = new Map<string, string>();
	for (let line of split(output, '\n')) {
		let [name, object, peeled] = line.split('\0');
		map.set(name, peeled || object);
	}
	return map;
}

/**
 * The files that differ between `from` and HEAD, relative to the top level.
 * @example await diff('repo', 'v1.0.0') //=> ['packages/a/index.js']
 */
export async function diff(cwd: string, from: string): Promise<string[]> {
	return split(await raw(cwd, ['diff', '-z', '--name-only', '--no-renames', from, 'HEAD', '--']), '\0');
}

/**
 * The SHAs of the commits after `from`, up to HEAD, without merge commits.
 * @example await commits('repo', 'v1.0.0') //=> ['a1b2c3…']
 */
export async function commits(cwd: string, from: string): Promise<string[]> {
	return split(await run(cwd, ['rev-list', '--no-merges', `${from}..HEAD`]), '\n');
}

/**
 * The files that the `shas` commits changed, relative to the top level.
 * @example await touched('repo', ['a1b2c3…']) //=> Set { 'packages/a/index.js' }
 */
export async function touched(cwd: string, shas: string[]): Promise<Set<string>> {
	if (!shas.length) return new Set();
	let args = ['diff-tree', '--stdin', '-z', '-r', '--root', '--no-commit-id', '--name-only', '--no-renames'];
	return new Set(split(await raw(cwd, args, shas.join('\n') + '\n'), '\0'));
}

/**
 * The tracked files with changes that are not committed, as `git status --porcelain` lists them.
 * @example await dirty('repo') //=> [' M packages/a/index.js']
 */
export async function dirty(cwd: string): Promise<string[]> {
	return split(await raw(cwd, ['status', '--porcelain', '--untracked-files=no']), '\n');
}

/**
 * The name of the merge, rebase, cherry-pick, revert, or bisect in progress, if any.
 * @example await busy('repo') //=> 'merge'
 */
export async function busy(cwd: string): Promise<string | undefined> {
	let states: [string, string][] = [
		['MERGE_HEAD', 'merge'],
		['CHERRY_PICK_HEAD', 'cherry-pick'],
		['REVERT_HEAD', 'revert'],
		['BISECT_LOG', 'bisect'],
		['rebase-merge', 'rebase'],
		['rebase-apply', 'rebase'],
	];
	for (let [name, state] of states) {
		let path = await run(cwd, ['rev-parse', '--git-path', name]);
		if (existsSync(isAbsolute(path) ? path : join(cwd, path))) return state;
	}
}

/**
 * Whether git tracks `file`.
 * @example await tracked('repo', 'Cargo.lock') //=> true
 */
export async function tracked(cwd: string, file: string): Promise<boolean> {
	return ok(cwd, ['ls-files', '--error-unmatch', '--', file]);
}
