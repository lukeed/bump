import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import * as jsonc from '@lukeed/jsonc';

import * as git from './git';
import * as semver from './semver';

import type { Options } from '..';

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

/** The keys that a config file can hold. */
export const KEYS = ['$schema', 'independent', 'packages', 'groups', 'preid', 'tag', 'message'];

const REMOVED: Record<string, string> = {
	version: '"version" was removed: versions come from the manifests',
	single: '"single" was removed: use "packages": ["."]',
	all: '"all" was removed: use --all',
};

export type Inline = Pick<Options, 'independent' | 'packages' | 'groups' | 'tag' | 'message'>;

/**
 * Find the root from `cwd`, and read and check its `bump.json` or `bump.jsonc` file, if any.
 * The `inline` values replace those of the file.
 * @example let config = await load('repo/packages/a', { independent: true });
 */
export async function load(cwd: string, inline: Inline = {}): Promise<Config> {
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

	let given = new Set<string>();
	for (let [key, value] of Object.entries(inline)) {
		if (value === undefined) continue;
		given.add(key);
		input[key] = value;
	}

	let fail = (message: string, key?: string): never => {
		throw new Error(`${message} in ${key && given.has(key) || !file ? 'the options' : `"${file}"`}`);
	};

	for (let key in input) {
		if (REMOVED[key]) fail(REMOVED[key], key);
		if (!KEYS.includes(key)) fail(`Unknown "${key}" key`, key);
	}

	let { independent = false, packages, groups = {}, preid = 'next' } = input;

	if (typeof independent !== 'boolean') fail('"independent" must be a boolean', 'independent');

	if (typeof packages === 'string') packages = [packages];
	if (packages !== undefined) {
		if (!Array.isArray(packages) || !packages.length || !packages.every(item => typeof item === 'string' && item)) {
			fail('"packages" must be a string or a non-empty array of strings', 'packages');
		}
	}

	if (!record(groups)) fail('"groups" must be an object', 'groups');
	let entries = Object.entries(record(groups) ? groups : {});
	for (let [name, members] of entries) {
		if (!Array.isArray(members) || !members.length || !members.every(item => typeof item === 'string' && item)) {
			fail(`"groups.${name}" must be a non-empty array of package names`, 'groups');
		}
	}
	if (entries.length && !independent) fail('"groups" needs "independent": true', 'groups');

	if (typeof preid !== 'string' || !semver.identifier(preid)) fail(`Invalid "preid" value: ${JSON.stringify(preid)}`, 'preid');

	let tag = input.tag ?? (independent ? '{name}@{version}' : 'v{version}');
	let message = input.message ?? (independent ? 'release: {tags}' : 'v{version}');

	let template = (key: string, text: unknown, allowed: string[], required: string[]): string => {
		if (typeof text !== 'string' || !text) return fail(`"${key}" must be a non-empty string`, key);
		for (let token of text.match(/\{[^{}]*\}/g) ?? []) {
			if (!allowed.includes(token)) fail(`Unknown "${token}" placeholder in "${key}"`, key);
		}
		if (/[{}]/.test(allowed.reduce((rest, token) => rest.replaceAll(token, ''), text))) fail(`Unmatched brace in "${key}"`, key);
		for (let token of required) {
			if (!text.includes(token)) fail(`Missing "${token}" placeholder in "${key}"`, key);
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
