import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import * as jsonc from '@lukeed/jsonc';

import * as git from './git';
import * as semver from './semver';

export type Config = {
	/** The folder of `bump.json`, else the git top level. */
	root: string;
	/** The git top level. */
	top: string;
	independent: boolean;
	/** The folder globs, relative to `root`. */
	packages?: string[];
	groups: Record<string, string[]>;
	preid: string;
	tag: string;
	message: string;
};

const FILES = ['bump.json', 'bump.jsonc'];

const REMOVED: Record<string, string> = {
	version: '"version" was removed: versions come from the manifests',
	single: '"single" was removed: use "packages": ["."]',
	all: '"all" was removed: use --all',
};

/**
 * Find the root from `cwd`, and read and check its `bump.json` or `bump.jsonc` file, if any.
 * @example let config = await load('repo/packages/a');
 */
export async function load(cwd: string): Promise<Config> {
	let start = resolve(cwd);
	if (!existsSync(start) || !statSync(start).isDirectory()) throw new Error(`Missing directory: "${cwd}"`);
	start = realpathSync(start);

	let top = await git.top(start);
	let file: string | undefined;
	for (let dir = start; !file; dir = dirname(dir)) {
		let found = FILES.map(name => join(dir, name)).filter(path => existsSync(path));
		if (found.length > 1) throw new Error(`Keep one of "${found.join('" and "')}"`);
		if (found.length) file = found[0];
		else if (dir === top || dir === dirname(dir)) break;
	}

	let root = file ? dirname(file) : top;
	let input: Record<string, unknown> = {};

	if (file) {
		try {
			var parsed = jsonc.parse<unknown>(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
		} catch (err) {
			throw new Error(`Invalid JSON in "${file}": ${err instanceof Error ? err.message : String(err)}`);
		}
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`"${file}" must hold a JSON object`);
		input = { ...parsed };
	}

	let fail = (message: string): never => {
		throw new Error(`${message} in "${file}"`);
	};

	for (let key in input) {
		if (REMOVED[key]) fail(REMOVED[key]);
		if (!['$schema', 'independent', 'packages', 'groups', 'preid', 'tag', 'message'].includes(key)) fail(`Unknown "${key}" key`);
	}

	let { independent = false, packages, groups = {}, preid = 'next' } = input;

	if (typeof independent !== 'boolean') fail('"independent" must be a boolean');

	if (typeof packages === 'string') packages = [packages];
	if (packages !== undefined) {
		if (!Array.isArray(packages) || !packages.length || !packages.every(item => typeof item === 'string' && item)) {
			fail('"packages" must be a string or a non-empty array of strings');
		}
	}

	if (!record(groups)) fail('"groups" must be an object');
	let entries = Object.entries(record(groups) ? groups : {});
	for (let [name, members] of entries) {
		if (!Array.isArray(members) || !members.length || !members.every(item => typeof item === 'string' && item)) {
			fail(`"groups.${name}" must be a non-empty array of package names`);
		}
	}
	if (entries.length && !independent) fail('"groups" needs "independent": true');

	if (typeof preid !== 'string' || !semver.identifier(preid)) fail(`Invalid "preid" value: ${JSON.stringify(preid)}`);

	let tag = input.tag ?? (independent ? '{name}@{version}' : 'v{version}');
	let message = input.message ?? (independent ? 'release: {tags}' : 'v{version}');

	let template = (key: string, text: unknown, allowed: string[], required: string[]): string => {
		if (typeof text !== 'string' || !text) return fail(`"${key}" must be a non-empty string`);
		for (let token of text.match(/\{[^{}]*\}/g) ?? []) {
			if (!allowed.includes(token)) fail(`Unknown "${token}" placeholder in "${key}"`);
		}
		if (/[{}]/.test(allowed.reduce((rest, token) => rest.replaceAll(token, ''), text))) fail(`Unmatched brace in "${key}"`);
		for (let token of required) {
			if (!text.includes(token)) fail(`Missing "${token}" placeholder in "${key}"`);
		}
		return text;
	};

	return {
		root,
		top,
		independent: independent === true,
		packages: Array.isArray(packages) ? packages.map(String) : undefined,
		groups: Object.fromEntries(entries.map(([name, members]) => [name, Array.isArray(members) ? members.map(String) : []])),
		preid: String(preid),
		tag: template('tag', tag, independent ? ['{name}', '{version}'] : ['{version}'], independent ? ['{name}', '{version}'] : ['{version}']),
		message: template('message', message, independent ? ['{tags}'] : ['{version}', '{tags}'], []),
	};
}

function record(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}
