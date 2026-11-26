import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as jsonc from '@lukeed/jsonc';

import * as semver from './semver';

import type { Package } from './find';

const FIELDS = {
	dependencies: 'runtime',
	peerDependencies: 'runtime',
	optionalDependencies: 'runtime',
	devDependencies: 'dev',
} as const;

/**
 * Parse a JSON or JSONC file, with the file name in the error.
 * @example let pkg = parse('packages/a/package.json');
 */
export function parse(file: string): Record<string, unknown> {
	try {
		var value = jsonc.parse<unknown>(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
	} catch (err) {
		throw new Error(`Invalid JSON in "${file}": ${err instanceof Error ? err.message : String(err)}`);
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`"${file}" must hold a JSON object`);
	return { ...value };
}

/**
 * The npm workspace globs at `root`, from `package.json` and `pnpm-workspace.yaml`, if either declares them.
 * @example members('repo') //=> ['packages/*']
 */
export function members(root: string): string[] | undefined {
	let found: string[] | undefined;
	let add = (list: unknown) => {
		if (!Array.isArray(list)) return;
		found = [...found ?? [], ...list.filter(item => typeof item === 'string')];
	};

	let manifest = join(root, 'package.json');
	if (existsSync(manifest)) {
		let { workspaces } = parse(manifest);
		add(Array.isArray(workspaces) ? workspaces : workspaces && typeof workspaces === 'object' ? Reflect.get(workspaces, 'packages') : undefined);
	}

	let pnpm = join(root, 'pnpm-workspace.yaml');
	if (existsSync(pnpm)) {
		let value: unknown = Bun.YAML.parse(readFileSync(pnpm, 'utf8'));
		if (value && typeof value === 'object') add(Reflect.get(value, 'packages'));
	}

	return found;
}

/**
 * The package of the `package.json` file in `dir`, if any.
 * @example read('repo/packages/a', console.warn) //=> { name: 'a', ecosystem: 'npm', … }
 */
export function read(dir: string, warn: (message: string) => void): Package | undefined {
	let file = join(dir, 'package.json');
	if (!existsSync(file)) return;

	let value = parse(file);
	if (typeof value.name !== 'string' || !value.name) return void warn(`Missing "name" field in "${file}"`);

	let version: Package['version'];
	if (value.version !== undefined) {
		if (typeof value.version !== 'string' || !semver.parse(value.version)) {
			throw new Error(`Invalid version ${JSON.stringify(value.version)} in "${file}"`);
		}
		version = { value: value.version, file, path: ['version'] };
	}

	let pkg: Package = {
		name: value.name,
		ecosystem: 'npm',
		dir,
		file,
		version,
		publish: value.private !== true,
		deps: [],
		ranges: [],
	};

	for (let [field, kind] of Object.entries(FIELDS)) {
		let deps = value[field];
		if (!deps || typeof deps !== 'object') continue;
		for (let [name, spec] of Object.entries(deps)) {
			if (typeof spec !== 'string' || spec.startsWith('npm:')) continue;
			pkg.deps.push({ name, kind });
			pkg.ranges.push({ file, path: [field, name], field, dependency: name, from: spec, package: pkg.name });
		}
	}

	return pkg;
}
