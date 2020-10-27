import semiver from 'semiver';
import escalade from 'escalade';
import { join, resolve } from 'path';
import { bump, exists, write } from './utils';
import { collect } from './find';
import * as git from './git';

import type { Config, Graph, Options, Version } from '..';

const CONFIG = 'bump.json';

export async function version(type: Version, argv: Options = {}) {
	const cwd = argv.cwd = resolve(argv.cwd || '.');
	const file = await escalade(argv.cwd, (dir, list) => {
		if (list.includes(CONFIG)) return join(dir, CONFIG);
	});

	if (!file) throw new Error('Missing "bump.json" file');
	const conf = require(file) as Config;
	const graph: Graph = new Map;

	const toAbs = (x: string) => join(cwd, x);

	const version = conf.version;
	const pkgDefault = toAbs('packages');
	conf.message = conf.message || 'v{VERSION}';
	conf.packages = ([] as string[]).concat(conf.packages || []);
	const packages = conf.packages.map(toAbs).filter(str => {
		return exists(str) || console.warn('directory does not exist:', str);
	});

	if (!packages.length && exists(pkgDefault)) {
		conf.packages.push('packages');
		packages.push(pkgDefault);
	} else if (!packages.length) {
		if (conf.single) packages.push(cwd);
		else throw new Error('Missing "packages" value');
	}

	await Promise.all(
		packages.map(dir => collect(dir, graph))
	);

	if (!graph.size) {
		throw new Error('No packages found!');
	}

	// all pkg dirs (diff)
	const dirs: string[] = [];

	for (const [key, pkg] of graph) {
		// throw if pkg.version > expected|current
		if (semiver(pkg.contents.version, version) > 0) {
			throw new Error(`"${pkg.name}@${pkg.contents.version}" is beyond expected "${version}" version`);
		}

		dirs.push(pkg.dir);

		for (let dep of pkg.deps) {
			// purge external dependencies
			graph.has(dep) || pkg.deps.delete(dep);
		}
	}

	// dirty package names
	const dirty: Set<string> = new Set;
	const files: Set<string> = new Set;

	if (argv.all) {
		for (const [name, pkg] of graph) {
			dirty.add(name);
		}
	} else {
		const known = new Set(dirs);

		function check(dir: string) {
			if (!known.has(dir)) return;
			for (const [name, pkg] of graph) {
				if (pkg.dir !== dir) continue;
				if (!dirty.has(name)) {
					dirty.add(name);
					pkg.deps.forEach(check);
				}
			}
		}

		await git.diff(version, dirs).then(list => {
			list.forEach(x => check(resolve('.', x)));
		});
	}

	const next = bump(version, type);
	console.log('~> bump all to:', next);

	let txt = '';
	await Promise.all(
		[...dirty].map(key => {
			const pkg = graph.get(key)!;
			txt += `\n~> "${key}" (v${pkg.contents.version} ~> v${next})`;
			pkg.contents.version = next;
			files.add(pkg.file);
			return write(pkg.file, JSON.stringify(pkg.contents, null, 2));
		})
	);

	console.log('Updated "package.json" files:' + txt);

	files.add(file);
	conf.version = next;
	await write(file, JSON.stringify(conf, null, 2));

	await git.add(files);
	await git.commit(next, conf.message);
	console.log('Done~!');
}
