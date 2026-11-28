import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';

import * as git from './git';
import * as lockfile from './lockfile';

import type { Lockfile } from './lockfile';

/** A release that stopped for a signal, after its undo. */
export class Interrupt extends Error {
	signal: 'SIGINT' | 'SIGTERM';

	constructor(signal: 'SIGINT' | 'SIGTERM') {
		super(`Stopped by ${signal}`);
		this.signal = signal;
	}
}

export type Input = {
	top: string;
	root: string;
	/** The SHA of HEAD before the release. */
	head: string;
	/** The new text of each file, by absolute path. */
	edits: Map<string, string>;
	locks: Lockfile[];
	message: string;
	tags: string[];
};

export type Output = {
	commit: string;
	/** The committed files, relative to the top level, sorted. */
	files: string[];
};

/**
 * Write the edits, update the lockfiles, commit, and add each tag on that commit.
 * On a failure, or on SIGINT or SIGTERM, undo every step, then throw.
 * @example let { commit } = await release({ top, root, head, edits, locks: [], message: 'v1.1.0', tags: ['v1.1.0'] });
 */
export async function release(input: Input): Promise<Output> {
	let { top } = input;
	let originals = new Map<string, Buffer>();
	for (let file of [...input.edits.keys(), ...input.locks.map(lock => lock.file)]) originals.set(file, readFileSync(file));

	let signal: Interrupt['signal'] | undefined;
	let onInt = () => void (signal ??= 'SIGINT');
	let onTerm = () => void (signal ??= 'SIGTERM');
	process.on('SIGINT', onInt);
	process.on('SIGTERM', onTerm);

	let check = () => {
		if (signal) throw new Interrupt(signal);
	};

	let created: string[] = [];
	let rel = (file: string) => relative(top, file).split('\\').join('/');

	try {
		for (let [file, text] of input.edits) await step(`Could not write "${rel(file)}"`, () => writeFileSync(file, text));
		check();

		let ran = new Set<string>();
		for (let lock of input.locks) {
			if (ran.has(lock.binary)) continue;
			ran.add(lock.binary);
			await step(`Could not update "${rel(lock.file)}"`, () => lockfile.update(input.root, lock));
			check();
		}

		for (let lock of input.locks) {
			if (!existsSync(lock.file)) throw new Error(`Could not update "${rel(lock.file)}": \`${lock.binary} ${lock.args.join(' ')}\` removed it`);
		}

		let files = [...originals]
			.filter(([file, bytes]) => input.edits.has(file) || !readFileSync(file).equals(bytes))
			.map(([file]) => rel(file))
			.sort();

		await step('Could not stage the files', () => git.run(top, ['add', '--', ...files]));
		check();
		await step('Could not commit', () => git.run(top, ['commit', '--message', input.message, '--', ...files]));
		let commit = (await git.run(top, ['rev-list', '--first-parent', '--reverse', `${input.head}..HEAD`])).split('\n')[0];
		check();

		for (let tag of input.tags) {
			await step(`Could not create tag "${tag}"`, () => git.run(top, ['tag', '--annotate', '--message', tag, tag, commit]));
			created.push(tag);
			check();
		}

		return { commit, files };
	} catch (err) {
		let failure = signal && !(err instanceof Interrupt) ? new Interrupt(signal) : err;
		await undo(input, originals, created, failure);
		let note = 'The release was undone: no files, commits, or tags changed.';
		if (failure instanceof Interrupt) {
			failure.message += `\n${note}`;
			throw failure;
		}
		throw new Error(`${failure instanceof Error ? failure.message : String(failure)}\n${note}`, { cause: failure });
	} finally {
		process.off('SIGINT', onInt);
		process.off('SIGTERM', onTerm);
	}
}

async function undo(input: Input, originals: Map<string, Buffer>, created: string[], failure: unknown): Promise<void> {
	let { top, head } = input;
	let files = [...originals.keys()].map(file => relative(top, file));
	let problems: string[] = [];
	let attempt = async (step: () => unknown) => {
		try {
			await step();
		} catch (err) {
			problems.push(err instanceof Error ? err.message : String(err));
		}
	};

	for (let tag of [...created].reverse()) await attempt(() => git.run(top, ['tag', '-d', tag]));
	await attempt(async () => {
		if ((await git.head(top)) !== head) await git.run(top, ['reset', '--soft', head]);
	});
	for (let [file, bytes] of originals) await attempt(() => writeFileSync(file, bytes));
	await attempt(() => git.run(top, ['reset', '--quiet', head, '--', ...files]));

	if (!problems.length) return;

	let tags: string[] = [];
	for (let tag of input.tags) {
		if (await git.ok(top, ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`])) tags.push(tag);
	}
	let current = await git.head(top);
	let changed = [...originals].filter(([file, bytes]) => !existsSync(file) || !readFileSync(file).equals(bytes)).map(([file]) => relative(top, file));

	let lines = [
		failure instanceof Error ? failure.message : String(failure),
		'',
		'The undo failed too:',
		...problems.map(problem => `  ${problem}`),
		'',
		'To clean up by hand:',
		...tags.map(tag => `  git tag -d ${tag}`),
		...current !== head ? [`  git reset --soft ${head}`] : [],
		...changed.length ? [`  git checkout ${head} -- ${changed.join(' ')}`] : [],
	];
	throw new Error(lines.join('\n'));
}

async function step<T>(what: string, run: () => T | Promise<T>): Promise<T> {
	try {
		return await run();
	} catch (err) {
		let text = err instanceof git.Failure ? err.stderr : err instanceof Error ? err.message : String(err);
		let lines = text.split('\n').map(line => line.trim()).filter(Boolean);
		let found = lines.find(line => /^(error|fatal): /.test(line));
		let reason = (found ?? lines[0] ?? 'unknown error').replace(/^(error|fatal): /, '').replace(/:$/, '');
		throw new Error(`${what}: ${reason}`, { cause: err });
	}
}
