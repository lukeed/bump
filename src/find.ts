import { existsSync, realpathSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import * as cargo from './cargo';
import * as npm from './npm';

import type { Ecosystem } from '..';
import type { Config } from './config';
import type { Path } from './edit';

export type Package = {
	name: string;
	ecosystem: Ecosystem;
	/** The real path of the package folder. */
	dir: string;
	/** The manifest file. */
	file: string;
	/** The version and where it is written, which can be a workspace manifest. */
	version?: Package.Location & { value: string };
	publish: boolean;
	deps: Package.Dep[];
	/** The dependency ranges that a release can rewrite. */
	ranges: Package.Range[];
	/** Cargo: the workspace root whose `[workspace.package] version` the crate inherits. */
	inherits?: string;
	/** Cargo: the folder of the crate's `Cargo.lock` file. */
	lock?: string;
};

export namespace Package {
	export type Location = { file: string; path: Path };
	export type Dep = { name: string; kind: 'runtime' | 'dev' };
	export type Range = Location & {
		field: string;
		dependency: string;
		from: string;
		/** The package that lists the range, if the range is in its own manifest. */
		package?: string;
	};
}

/**
 * The folders under `root` that match the `include` globs, but no `exclude` glob, sorted by relative path.
 * @example dirs('repo', ['packages/*'], ['packages/internal-*']) //=> ['repo/packages/a']
 */
export function dirs(root: string, include: string[], exclude: string[] = []): string[] {
	let clean = (pattern: string) => pattern.replace(/^\.\//, '').replace(/\/+$/, '') || '.';
	let excluded = exclude.map(pattern => new Bun.Glob(clean(pattern)));
	let found = new Set<string>();

	for (let pattern of include.map(clean)) {
		let matches = pattern === '.'
			? ['.']
			: [...new Bun.Glob(pattern).scanSync({ cwd: root, onlyFiles: false, dot: false })];
		for (let rel of matches) {
			let parts = rel === '.' ? [] : rel.split(/[\\/]/);
			if (parts.some(part => part === 'node_modules' || part.startsWith('.'))) continue;
			if (parts.some((_, index) => excluded.some(glob => glob.match(parts.slice(0, index + 1).join('/'))))) continue;
			let dir = join(root, rel);
			if (statSync(dir).isDirectory()) found.add(parts.join('/'));
		}
	}

	return [...found].sort().map(rel => realpathSync(join(root, rel)));
}

/**
 * Discover every package, by the `packages` globs of the config, else by the workspace files of each ecosystem.
 * @example let list = packages(config, console.warn);
 */
export function packages(config: Config, warn: (message: string) => void): Package[] {
	let { root, top } = config;
	let found: Package[] = [];
	let add = (pkg: Package | undefined) => pkg && found.push(pkg);

	let split = (patterns: string[]): [string[], string[]] => [
		patterns.filter(pattern => !pattern.startsWith('!')),
		patterns.filter(pattern => pattern.startsWith('!')).map(pattern => pattern.slice(1)),
	];

	if (config.packages) {
		for (let dir of dirs(root, ...split(config.packages))) {
			add(npm.read(dir, warn));
			add(cargo.read(dir, top, warn));
		}
	} else {
		for (let dir of dirs(root, ...split(npm.members(root) ?? ['.']))) add(npm.read(dir, warn));

		let workspace = cargo.members(root);
		let crates = dirs(root, workspace?.include ?? ['.'], workspace?.exclude).filter(dir => existsSync(join(dir, 'Cargo.toml')));
		let excluded = dirs(root, workspace?.exclude ?? []);
		for (let index = 0; workspace && index < crates.length; index++) {
			for (let dir of cargo.paths(crates[index], top)) {
				if (!existsSync(join(dir, 'Cargo.toml')) || relative(root, dir).startsWith('..')) continue;
				let real = realpathSync(dir);
				if (!crates.includes(real) && !excluded.some(dir => real === dir || real.startsWith(dir + sep)) && real.startsWith(root + sep)) crates.push(real);
			}
		}
		for (let dir of crates) add(cargo.read(dir, top, warn));
	}

	let names = new Map<string, Package>();
	for (let pkg of found) {
		let other = names.get(pkg.name);
		if (other) throw new Error(`Two packages are named "${pkg.name}": "${other.file}" and "${pkg.file}"`);
		names.set(pkg.name, pkg);
	}

	if (!found.length) throw new Error('No packages found');
	if (!found.some(pkg => pkg.version)) throw new Error('No versioned packages found');
	return found;
}
