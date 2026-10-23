import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/**
 * Run `git` with `args` in `cwd`, and return its output, trimmed.
 * @example await run('repo', ['tag', '--list']) //=> 'v1.0.0'
 */
export async function run(cwd: string, args: string[]): Promise<string> {
	try {
		var { stdout } = await exec('git', args, { cwd });
	} catch (err) {
		let { code, stderr } = err as { code?: string | number; stderr?: string };
		if (code === 'ENOENT') throw new Error('Missing `git` binary');
		throw new Error(`\`git ${args.join(' ')}\` failed: ${stderr?.trim() || String(err)}`, { cause: err });
	}
	return stdout.trim();
}

/**
 * The real path of the repository that `cwd` is in.
 * @example await root('repo/packages/a') //=> '/home/me/repo'
 */
export async function root(cwd: string): Promise<string> {
	return realpathSync(await run(cwd, ['rev-parse', '--show-toplevel']));
}

/**
 * Whether the repository has the `name` tag.
 * @example await tagged('repo', 'v1.0.0') //=> true
 */
export async function tagged(cwd: string, name: string): Promise<boolean> {
	return run(cwd, ['rev-parse', '--quiet', '--verify', `refs/tags/${name}`]).then(() => true, () => false);
}

/**
 * The files that changed from the `tag` commit to HEAD, relative to the repository root.
 * @example await changed('repo', 'v1.0.0') //=> ['packages/a/index.js']
 */
export async function changed(cwd: string, tag: string): Promise<string[]> {
	let output = await run(cwd, ['diff', '--name-only', '--no-renames', tag, 'HEAD', '--']);
	return output ? output.split(/\r?\n/) : [];
}

/**
 * The tracked files with changes that are not committed, as `git status --porcelain` lists them.
 * @example await dirty('repo') //=> [' M packages/a/index.js']
 */
export async function dirty(cwd: string): Promise<string[]> {
	let output = await run(cwd, ['status', '--porcelain', '--untracked-files=no']);
	return output ? output.split(/\r?\n/) : [];
}

/**
 * Commit `files` with `message`, and add the annotated `tag` with the same message.
 * When git fails, `files` return to HEAD and the commit is undone, so no part of the release stays.
 * @example await release('repo', ['packages/a/package.json'], 'v1.1.0', 'v1.1.0');
 */
export async function release(cwd: string, files: string[], message: string, tag: string): Promise<void> {
	let restore = () => run(cwd, ['restore', '--source=HEAD', '--staged', '--worktree', '--', ...files]);

	try {
		await run(cwd, ['add', '--', ...files]);
		await run(cwd, ['commit', '--message', message, '--', ...files]);
	} catch (err) {
		await restore();
		throw err;
	}

	try {
		await run(cwd, ['tag', '--annotate', '--message', message, tag]);
	} catch (err) {
		await run(cwd, ['reset', '--soft', 'HEAD~1']);
		await restore();
		throw err;
	}
}
