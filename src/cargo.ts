import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import * as semver from './semver';

import type { Path } from './edit';
import type { Package } from './find';

type Table = Record<string, unknown>;

const KINDS = [
	['dependencies', 'runtime'],
	['build-dependencies', 'runtime'],
	['dev-dependencies', 'dev'],
] as const;

function table(value: unknown): Table {
	return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
}

/**
 * Parse a TOML file, with the file name in the error.
 * @example let manifest = parse('crates/a/Cargo.toml');
 */
export function parse(file: string): Table {
	try {
		return table(Bun.TOML.parse(readFileSync(file, 'utf8')));
	} catch (err) {
		throw new Error(`Invalid TOML in "${file}": ${err instanceof Error ? err.message : String(err)}`);
	}
}

/**
 * The Cargo workspace root of the crate in `dir`, if it has one. The search stops at `top`.
 * @example root('repo/crates/a', 'repo') //=> 'repo'
 */
export function root(dir: string, top: string): string | undefined {
	let manifest = parse(join(dir, 'Cargo.toml'));
	let link = table(manifest.package).workspace;
	if (typeof link === 'string') return resolve(dir, link);
	if (manifest.workspace) return dir;
	if (dir === top) return;
	for (let parent = dirname(dir); ; parent = dirname(parent)) {
		let file = join(parent, 'Cargo.toml');
		if (existsSync(file) && parse(file).workspace) return parent;
		if (parent === top || parent === dirname(parent)) return;
	}
}

/**
 * The member and exclude globs of the Cargo workspace at `dir`, if `dir` holds one.
 * @example members('repo') //=> { include: ['crates/*', '.'], exclude: [] }
 */
export function members(dir: string): { include: string[]; exclude: string[] } | undefined {
	let file = join(dir, 'Cargo.toml');
	if (!existsSync(file)) return;
	let manifest = parse(file);
	if (!manifest.workspace) return;
	let workspace = table(manifest.workspace);
	let strings = (value: unknown) => Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
	let include = strings(workspace.members);
	if (manifest.package) include.push('.');
	return { include, exclude: strings(workspace.exclude) };
}

function* tables(manifest: Table): Generator<[field: string, kind: 'runtime' | 'dev', entries: Table, path: Path]> {
	for (let [key, kind] of KINDS) yield [key, kind, table(manifest[key]), [key]];
	for (let [cfg, target] of Object.entries(table(manifest.target))) {
		for (let [key, kind] of KINDS) yield [`target.'${cfg}'.${key}`, kind, table(table(target)[key]), ['target', cfg, key]];
	}
}

/**
 * The folders of the path dependencies of the crate in `dir`, also those it inherits from its workspace.
 * @example paths('repo/crates/a', 'repo') //=> ['repo/crates/b']
 */
export function paths(dir: string, top: string): string[] {
	let manifest = parse(join(dir, 'Cargo.toml'));
	let workspace = manifest.package ? root(dir, top) : undefined;
	let shared = workspace ? table(table(parse(join(workspace, 'Cargo.toml')).workspace).dependencies) : {};
	let found: string[] = [];
	for (let [, , entries] of tables(manifest)) {
		for (let [key, entry] of Object.entries(entries)) {
			let spec = table(entry);
			let path = spec.workspace === true ? table(shared[key]).path : spec.path;
			if (typeof path === 'string') found.push(resolve(spec.workspace === true && workspace ? workspace : dir, path));
		}
	}
	return found;
}

/**
 * The crate of the `Cargo.toml` file in `dir`, if any. A virtual manifest is no crate.
 * @example read('repo/crates/a', 'repo', console.warn) //=> { name: 'a', ecosystem: 'cargo', … }
 */
export function read(dir: string, top: string, warn: (message: string) => void): Package | undefined {
	let file = join(dir, 'Cargo.toml');
	if (!existsSync(file)) return;

	let manifest = parse(file);
	if (!manifest.package && manifest.workspace) return;

	let pkg = table(manifest.package);
	if (typeof pkg.name !== 'string' || !pkg.name) return void warn(`Missing "package.name" field in "${file}"`);

	let workspace = root(dir, top);
	let shared = workspace ? join(workspace, 'Cargo.toml') : undefined;
	let inherited = shared ? table(parse(shared).workspace) : {};
	let inherit = (value: unknown) => table(value).workspace === true;

	let version: Package['version'];
	if (typeof pkg.version === 'string') {
		if (!semver.parse(pkg.version)) throw new Error(`Invalid version "${pkg.version}" in "${file}"`);
		version = { value: pkg.version, file, path: ['package', 'version'] };
	} else if (inherit(pkg.version)) {
		let value = table(inherited.package).version;
		if (!shared || typeof value !== 'string') throw new Error(`Missing "workspace.package.version" field for "${file}"`);
		if (!semver.parse(value)) throw new Error(`Invalid version "${value}" in "${shared}"`);
		version = { value, file: shared, path: ['workspace', 'package', 'version'] };
	}

	let publish = inherit(pkg.publish) ? table(inherited.package).publish : pkg.publish;

	let crate: Package = {
		name: pkg.name,
		ecosystem: 'cargo',
		dir,
		file,
		version,
		publish: publish !== false && !(Array.isArray(publish) && !publish.length),
		deps: [],
		ranges: [],
		inherits: inherit(pkg.version) ? workspace : undefined,
		lock: workspace ?? dir,
	};

	for (let [field, kind, entries, path] of tables(manifest)) {
		for (let [key, entry] of Object.entries(entries)) {
			if (typeof entry === 'string') {
				crate.deps.push({ name: key, kind });
				crate.ranges.push({ file, path: [...path, key], field, dependency: key, from: entry, package: crate.name });
				continue;
			}

			let spec = table(entry);
			if (spec.workspace === true && shared) {
				let base = table(inherited.dependencies)[key];
				let name = typeof base === 'string' ? key : String(table(base).package ?? key);
				let from = typeof base === 'string' ? base : table(base).version;
				crate.deps.push({ name, kind });
				if (typeof from === 'string') {
					let at = typeof base === 'string' ? ['workspace', 'dependencies', key] : ['workspace', 'dependencies', key, 'version'];
					crate.ranges.push({ file: shared, path: at, field: 'workspace.dependencies', dependency: name, from });
				}
				continue;
			}

			let name = typeof spec.package === 'string' ? spec.package : key;
			crate.deps.push({ name, kind });
			if (typeof spec.version === 'string') {
				crate.ranges.push({ file, path: [...path, key, 'version'], field, dependency: name, from: spec.version, package: crate.name });
			}
		}
	}

	return crate;
}
