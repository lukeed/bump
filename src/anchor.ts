import { join, sep } from 'node:path';

import * as git from './git';
import * as semver from './semver';
import * as units from './units';

import type { Config } from './config';
import type { Package } from './find';
import type { Unit } from './units';

export type State =
	| { kind: 'normal'; anchor: string }
	| { kind: 'first' }
	| { kind: 'missing' };

/**
 * Find the anchor tag of each unit in `scope`, by its manifest version and the tags of the repository.
 * Throws when a reachable tag is beyond the manifest, or when the manifest's tag is not in the history of HEAD.
 * @example let states = await resolve(config, scope);
 */
export async function resolve(config: Config, scope: Unit[]): Promise<Map<Unit, State>> {
	let all = await git.tags(config.top);
	let reachable = new Set(await git.tags(config.top, true));
	let states = new Map<Unit, State>();

	for (let unit of scope) {
		let current = unit.version;
		for (let name of reachable) {
			let found = unit.pattern.exec(name)?.[1];
			if (found && semver.compare(found, current) > 0) throw new Error(`"${name}" is released, but the manifest says ${current}`);
		}

		let own = units.tag(config, unit, current);
		if (reachable.has(own)) states.set(unit, { kind: 'normal', anchor: own });
		else if (all.includes(own)) throw new Error(`The "${own}" release commit is not in the history of HEAD; merge it first`);
		else if (current === '0.0.0') states.set(unit, { kind: 'first' });
		else states.set(unit, { kind: 'missing' });
	}

	return states;
}

/**
 * The units with an anchor whose members own a file that changed since that anchor, by a commit that no unit tag points to.
 * @example let set = await changed(config, packages, units, states);
 */
export async function changed(config: Config, packages: Package[], list: Unit[], states: Map<Unit, State>): Promise<Set<Unit>> {
	let { top } = config;
	let dirs = [...new Set(packages.map(pkg => pkg.dir))].sort((a, b) => b.length - a.length);
	let owners = (file: string) => {
		let dir = dirs.find(dir => file === dir || file.startsWith(dir + sep));
		return dir ? packages.filter(pkg => pkg.dir === dir) : [];
	};

	let releases = new Set<string>();
	for (let [name, commit] of await git.targets(top)) {
		if (list.some(unit => unit.pattern.test(name))) releases.add(commit);
	}

	let cache = new Map<string, Set<Package>>();
	let output = new Set<Unit>();

	for (let [unit, state] of states) {
		if (state.kind !== 'normal') continue;

		let touched = cache.get(state.anchor);
		if (!touched) {
			let files = await git.diff(top, state.anchor);
			let shas = files.length ? await git.commits(top, state.anchor) : [];
			let release = await git.touched(top, shas.filter(sha => releases.has(sha)));
			let other = await git.touched(top, shas.filter(sha => !releases.has(sha)));
			let counted = files.filter(file => !release.has(file) || other.has(file));
			touched = new Set(counted.flatMap(file => owners(join(top, file))));
			cache.set(state.anchor, touched);
		}

		if (unit.members.some(pkg => touched.has(pkg))) output.add(unit);
	}

	return output;
}
