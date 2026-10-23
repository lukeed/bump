import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import escalade from 'escalade';
import semiver from 'semiver';

import { collect } from './find';
import * as git from './git';
import * as utils from './utils';

import type { Config, Graph, Manifest, Options, Package, Version } from '..';

const CONFIG = 'bump.json';

// A new version of a package in these fields is a new version of the package that lists it.
const RUNTIME = ['dependencies', 'peerDependencies', 'optionalDependencies'] as const;
const FIELDS = [...RUNTIME, 'devDependencies'] as const;

export async function version(type: Version, options: Options = {}): Promise<void> {
	let dry = !!options.dryrun;
	let cwd = resolve(options.cwd || '.');

	let file = await escalade(cwd, (dir, names) => {
		if (names.includes(CONFIG)) return join(dir, CONFIG);
	});
	if (!file) throw new Error(`Missing "${CONFIG}" file`);

	let base = dirname(file);
	let config = utils.read<Config>(file);
	let conf = config.value;
	let message = conf.message || 'v{VERSION}';
	let current = conf.version;
	if (!current) throw new Error(`Missing "version" field in "${file}"`);

	let graph: Graph = new Map;
	let folders = ([] as string[]).concat(conf.packages || []).map(dir => join(base, dir));
	for (let dir of folders) {
		if (!existsSync(dir)) console.warn('directory does not exist:', dir);
	}
	folders = folders.filter(existsSync);
	if (!folders.length) {
		if (conf.single) folders.push(base);
		else if (existsSync(join(base, 'packages'))) folders.push(join(base, 'packages'));
		else throw new Error('Missing "packages" value');
	}
	for (let dir of folders) collect(dir, graph);
	if (!graph.size) throw new Error('No packages found!');

	for (let pkg of graph.values()) {
		if (semiver(pkg.contents.version, current) > 0) {
			throw new Error(`"${pkg.name}@${pkg.contents.version}" is beyond expected "${current}" version`);
		}
	}

	let root = await git.root(base);
	let tag = 'v' + current;
	let picked: Set<Package>;

	if (options.all ?? conf.all) {
		picked = new Set(graph.values());
	} else if (await git.tagged(root, tag)) {
		let owners = (await git.changed(root, tag)).map(rel => owner(graph, join(root, rel)));
		picked = dependents(graph, owners.filter(pkg => pkg !== undefined));
	} else if (current === '0.0.0') {
		picked = new Set(graph.values());
	} else {
		throw new Error(`Missing "${tag}" tag in \`git\` history!`);
	}

	if (!picked.size) return console.log('! no changes since "%s" version', current);

	let next = utils.bump(current, type);
	let release = message.replace(/{VERSION}/gi, next);

	if (await git.tagged(root, 'v' + next)) throw new Error(`The "v${next}" tag already exists`);
	let changes = await git.dirty(root);
	if (changes.length && !dry) {
		throw new Error(`Commit or stash the changes to tracked files first:\n${changes.join('\n')}`);
	}

	console.log('~> bump all to:', next);

	let edits: Map<string, utils.Json<Manifest>> = new Map;
	let log = '';
	for (let pkg of picked) {
		log += `\n~> "${pkg.name}" (v${pkg.contents.version} ~> v${next})`;
		manifest(edits, pkg).value.version = next;
	}

	// each package that lists a new version gets its range, with the same prefix
	for (let pkg of graph.values()) {
		for (let field of FIELDS) {
			let deps = pkg.contents[field];
			for (let name in deps) {
				let dep = graph.get(name);
				if (!dep || !picked.has(dep)) continue;
				let spec = utils.range(deps[name], next);
				if (spec === deps[name]) continue;
				let target = manifest(edits, pkg).value[field];
				if (target) target[name] = spec;
				log += `\n~> "${pkg.name}" ${field}["${name}"]: "${deps[name]}" ~> "${spec}"`;
			}
		}
	}

	console.log('Updated "package.json" files:' + log);

	if (dry) {
		if (changes.length) console.warn('! a release needs a clean tree; these tracked files have changes:\n' + changes.join('\n'));
		return console.log('Dry run: no files were written');
	}

	for (let [path, json] of edits) utils.write(path, json);
	utils.write(file, { ...config, value: { ...conf, version: next } });

	let files = [...edits.keys(), file].map(path => relative(root, path));
	await git.release(root, files, release, 'v' + next);

	console.log('Done~!');
}

// The package whose folder holds `file`: the deepest one, when packages nest.
function owner(graph: Graph, file: string): Package | undefined {
	let found: Package | undefined;
	for (let pkg of graph.values()) {
		if (file !== pkg.dir && !file.startsWith(pkg.dir + sep)) continue;
		if (!found || pkg.dir.length > found.dir.length) found = pkg;
	}
	return found;
}

// `changed`, and each package that depends on one of them at runtime, as far as that goes.
function dependents(graph: Graph, changed: Package[]): Set<Package> {
	let picked: Set<Package> = new Set;
	let queue = [...changed];
	for (let pkg = queue.pop(); pkg; pkg = queue.pop()) {
		if (picked.has(pkg)) continue;
		picked.add(pkg);
		let name = pkg.name;
		for (let other of graph.values()) {
			if (RUNTIME.some(field => other.contents[field]?.[name] !== undefined)) queue.push(other);
		}
	}
	return picked;
}

// The edit of the `package.json` file of `pkg`, read once.
function manifest(edits: Map<string, utils.Json<Manifest>>, pkg: Package): utils.Json<Manifest> {
	let json = edits.get(pkg.file);
	if (!json) edits.set(pkg.file, json = utils.read<Manifest>(pkg.file));
	return json;
}
