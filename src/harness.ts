import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { setDefaultTimeout } from 'bun:test';

const ROOT = join(import.meta.dirname, '..');
const BIN = join(ROOT, 'bin.js');

export type Repo = {
	dir: string;
	env: Record<string, string | undefined>;
};

export type Run = {
	code: number;
	stdout: string;
	stderr: string;
};

// Windows runs these end-to-end tests about 4x slower than Linux.
setDefaultTimeout(30_000);

let made: string[] = [];
let built = false;

/**
 * Build `bin.js` once per test process.
 * @example beforeAll(build);
 */
export function build(): void {
	if (built) return;
	execFileSync('bun', ['run', 'build'], { cwd: ROOT, stdio: 'ignore' });
	built = true;
}

/**
 * Remove every repository made since the last call.
 * @example afterEach(clean);
 */
export function clean(): void {
	for (let dir of made) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
	made = [];
}

/**
 * A new git repository with `files`, its own git config, and one commit. Tags it `tag`, unless `tag` is false.
 * @example let r = repo({ 'package.json': manifest('a', '1.0.0') }, { tag: 'v1.0.0' });
 */
export function repo(files: Record<string, string>, opts: { tag?: string | false; config?: string } = {}): Repo {
	let temp = mkdtempSync(join(tmpdir(), 'bump-'));
	made.push(temp);
	execFileSync('git', ['init', '--quiet', '--initial-branch=main', temp], { stdio: 'ignore', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } });
	let dir = realpathSync(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: temp, encoding: 'utf8' }).trim());
	let home = join(dir, '.home');
	let bin = join(home, 'bin');
	mkdirSync(bin, { recursive: true });
	writeFileSync(join(home, '.gitconfig'), `[user]\n\tname = Test\n\temail = test@example.com\n[init]\n\tdefaultBranch = main\n[advice]\n\tdetachedHead = false\n${opts.config ?? ''}`);

	let env = {
		...process.env,
		HOME: home,
		GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
		GIT_CONFIG_NOSYSTEM: '1',
		PATH: [bin, join(ROOT, 'node_modules', '.bin'), process.env.PATH].join(delimiter),
	};
	let r = { dir, env };
	write(r, { '.gitignore': '.home\n', ...files });
	git(r, 'add', '-A');
	git(r, 'commit', '--quiet', '--no-gpg-sign', '--allow-empty', '-m', 'init');
	if (opts.tag) tag(r, opts.tag);
	return r;
}

/**
 * Run git in the repository, and return its trimmed output.
 * @example git(r, 'log', '-1', '--format=%s') //=> 'v1.1.0'
 */
export function git(r: Repo, ...args: string[]): string {
	return execFileSync('git', args, { cwd: r.dir, env: r.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/**
 * Add an annotated, unsigned tag on HEAD.
 * @example tag(r, 'v1.0.0');
 */
export function tag(r: Repo, name: string): void {
	git(r, 'tag', '--no-sign', '-a', '-m', name, name);
}

/**
 * Write `files` into the repository, without a commit.
 * @example write(r, { 'packages/a/x.js': '1' });
 */
export function write(r: Repo, files: Record<string, string>): void {
	for (let [rel, text] of Object.entries(files)) {
		mkdirSync(dirname(join(r.dir, rel)), { recursive: true });
		writeFileSync(join(r.dir, rel), text);
	}
}

/**
 * Write `files`, and commit all changes.
 * @example commit(r, { 'packages/a/x.js': '1' });
 */
export function commit(r: Repo, files: Record<string, string>, message = 'change'): void {
	write(r, files);
	git(r, 'add', '-A');
	git(r, 'commit', '--quiet', '--no-gpg-sign', '-m', message);
}

/**
 * Run the built CLI in the repository.
 * @example let { code, stdout } = bump(r, 'minor');
 */
export function bump(r: Repo, ...args: string[]): Run {
	let proc = spawnSync(process.execPath, [BIN, ...args], { cwd: r.dir, env: r.env, encoding: 'utf8' });
	return { code: proc.status ?? 1, stdout: proc.stdout, stderr: proc.stderr };
}

/**
 * The text of a file in the repository.
 * @example read(r, 'package.json')
 */
export function read(r: Repo, rel: string): string {
	return readFileSync(join(r.dir, rel), 'utf8');
}

/**
 * The `version` of a `package.json` file in the repository.
 * @example version(r, 'packages/a') //=> '1.1.0'
 */
export function version(r: Repo, dir: string): string {
	return JSON.parse(read(r, join(dir, 'package.json'))).version;
}

/**
 * A `package.json` text with `name`, `version`, and `extra` fields.
 * @example manifest('a', '1.0.0', { dependencies: { b: '^1.0.0' } })
 */
export function manifest(name: string, version: string | undefined, extra: object = {}): string {
	return JSON.stringify({ name, ...version === undefined ? {} : { version }, ...extra }, null, 2) + '\n';
}

/**
 * A `Cargo.toml` text for a crate.
 * @example crate('a', '1.0.0', '[dependencies]\nb = { path = "../b", version = "1.0.0" }')
 */
export function crate(name: string, version: string, rest = ''): string {
	return `[package]\nname = "${name}"\nversion = ${version.startsWith('{') ? version : `"${version}"`}\nedition = "2021"\n${rest ? `\n${rest}\n` : ''}`;
}

/**
 * A program for git's `gpg.program` that signs anything, or fails when `fail` is set.
 * @example git(r, 'config', '--global', 'gpg.program', gpg(r));
 */
export function gpg(r: Repo, fail = false): string {
	let file = join(r.dir, '.home', fail ? 'gpg-fail.sh' : 'gpg.sh');
	let body = fail
		? '#!/bin/sh\ncat > /dev/null\necho "gpg: signing failed" >&2\nexit 2\n'
		: '#!/bin/sh\ncat > /dev/null\nprintf "\\n[GNUPG:] SIG_CREATED D 1 8 00 0 FAKE\\n" >&2\nprintf -- "-----BEGIN PGP SIGNATURE-----\\n\\nfake\\n-----END PGP SIGNATURE-----\\n"\n';
	writeFileSync(file, body);
	chmodSync(file, 0o755);
	return file;
}

/**
 * Turn on tag signing with a fake gpg program.
 * @example sign(r, true);
 */
export function sign(r: Repo, fail = false): void {
	git(r, 'config', '--global', 'tag.gpgSign', 'true');
	git(r, 'config', '--global', 'gpg.program', gpg(r, fail));
	git(r, 'config', '--global', 'user.signingkey', 'FAKE');
}

/**
 * Put a fake `name` program first on the PATH of the repository, which runs the `code` script with Bun.
 * @example shim(r, 'npm', 'process.exit(1)');
 */
export function shim(r: Repo, name: string, code: string): void {
	let file = join(r.dir, '.home', 'bin', name);
	writeFileSync(`${file}.js`, code);
	writeFileSync(file, `#!/bin/sh\nexec "${process.execPath}" "${file}.js" "$@"\n`);
	chmodSync(file, 0o755);
	writeFileSync(`${file}.cmd`, `@"${process.execPath}" "${file}.js" %*\r\n`);
}
