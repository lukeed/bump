import { existsSync } from 'node:fs';
import { join } from 'node:path';

import * as git from './git';

export type Lockfile = {
	/** The lockfile path. */
	file: string;
	binary: string;
	args: string[];
};

const MANAGERS: [file: string, binary: string, args: string[]][] = [
	['package-lock.json', 'npm', ['install', '--package-lock-only', '--ignore-scripts']],
	['bun.lock', 'bun', ['install', '--lockfile-only', '--ignore-scripts']],
	['bun.lockb', 'bun', ['install', '--lockfile-only', '--ignore-scripts']],
	['pnpm-lock.yaml', 'pnpm', ['install', '--lockfile-only', '--ignore-scripts', '--no-frozen-lockfile']],
	['yarn.lock', 'yarn', ['install', '--mode=update-lockfile', '--no-immutable']],
];

async function exec(cwd: string, binary: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
	try {
		var proc = Bun.spawn([binary, ...args], { cwd, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
	} catch {
		return { code: 127, stdout: '', stderr: '' };
	}
	let [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { code, stdout: stdout.trim(), stderr: stderr.trim() };
}

/**
 * The npm lockfiles in `root` that git tracks, with the command that updates each one.
 * Throws when a needed package manager is missing. Skips a Yarn 1 lockfile, with a warning.
 * @example await find('repo', 'repo', console.warn) //=> [{ file: 'repo/package-lock.json', binary: 'npm', … }]
 */
export async function find(root: string, top: string, warn: (message: string) => void): Promise<Lockfile[]> {
	let found: Lockfile[] = [];
	for (let [name, binary, args] of MANAGERS) {
		let file = join(root, name);
		if (!existsSync(file) || !(await git.tracked(top, file))) continue;
		let probe = await exec(root, binary, ['--version']);
		if (probe.code !== 0) throw new Error(`Missing "${binary}" binary to update "${file}"`);
		if (binary === 'yarn' && probe.stdout.split('\n').some(line => line.startsWith('1.'))) {
			warn(`Yarn 1 cannot update "${file}" without an install; the lockfile is not updated`);
			continue;
		}
		found.push({ file, binary, args });
	}
	return found;
}

/**
 * Run the command that updates `lock`, in `root`.
 * @example await update('repo', lock);
 */
export async function update(root: string, lock: Lockfile): Promise<void> {
	let { code, stdout, stderr } = await exec(root, lock.binary, lock.args);
	if (code !== 0) throw new Error(`\`${lock.binary} ${lock.args.join(' ')}\` failed: ${stderr || stdout || `exit code ${code}`}`);
}

