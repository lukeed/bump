import * as semver from './semver';
import * as units from './units';

import type { Reason, Type } from '..';
import type { State } from './anchor';
import type { Package } from './find';
import type { Unit } from './units';

export type Pick = {
	unit: Unit;
	reason: Reason;
	type: Type | 'exact';
	from: string;
	to: string;
};

export type Input = {
	/** Every unit of the repository. */
	units: Unit[];
	independent: boolean;
	/** The units named on the command line. */
	targets?: Set<Unit>;
	states: Map<Unit, State>;
	changed: Set<Unit>;
	type?: Type;
	exact?: string;
	all: boolean;
	adopt: boolean;
	/** The `--preid` value. */
	preid?: string;
	/** The `preid` of bump.json. */
	base: string;
};

/**
 * The units that `targets` select, and every unit that depends on them at runtime, directly or not.
 * @example scope(list, new Set([app])) //=> [app, cli]
 */
export function scope(list: Unit[], targets?: Set<Unit>): Unit[] {
	if (!targets) return list;
	let found = new Set(targets);
	for (let size = 0; size !== found.size;) {
		size = found.size;
		for (let unit of list) {
			if ([...unit.deps].some(dep => found.has(dep))) found.add(unit);
		}
	}
	return list.filter(unit => found.has(unit));
}

/**
 * Select the units to release, with their reasons and next versions, in release order.
 * @example let picks = plan({ units, independent: true, states, changed, type: 'minor', all: false, adopt: false, base: 'next' });
 */
export function plan(input: Input): Pick[] {
	let { states, changed, targets } = input;

	let reason = (unit: Unit): Reason | undefined => {
		let state = states.get(unit);
		if (targets?.has(unit)) return 'target';
		if (!state || targets) return;
		if (state.kind === 'first') return 'first';
		if (state.kind === 'missing') return input.adopt ? 'adopted' : undefined;
		if (changed.has(unit)) return 'changed';
		if (input.all) return 'all';
	};

	let seeds = new Map<Unit, Reason>();
	for (let unit of input.units) {
		let found = reason(unit);
		if (found) seeds.set(unit, found);
	}

	let selected = new Set(seeds.keys());
	for (let size = 0; input.independent && size !== selected.size;) {
		size = selected.size;
		for (let unit of input.units) {
			if (states.has(unit) && [...unit.deps].some(dep => selected.has(dep))) selected.add(unit);
		}
	}

	let next = new Map<Unit, string>();
	let types = new Map<Unit, Type | 'exact'>();
	for (let unit of seeds.keys()) {
		next.set(unit, input.exact ?? semver.inc(unit.version, input.type ?? 'patch', input.preid, input.base));
		types.set(unit, input.exact ? 'exact' : input.type ?? 'patch');
	}

	let dependents = [...selected].filter(unit => !seeds.has(unit));
	let pre = (version: string) => !!semver.parse(version)?.pre.length;
	let triggered = new Set<Unit>();
	let prerelease = (unit: Unit) => {
		let version = next.get(unit);
		return version ? pre(version) : pre(unit.version) || triggered.has(unit);
	};
	for (let size = -1; size !== triggered.size;) {
		size = triggered.size;
		for (let unit of dependents) {
			if ([...unit.deps].some(dep => selected.has(dep) && prerelease(dep))) triggered.add(unit);
		}
	}

	for (let unit of dependents) {
		if (pre(unit.version)) {
			try {
				next.set(unit, semver.inc(unit.version, 'prerelease'));
			} catch {
				throw new Error(`Cannot continue the "${unit.version}" prerelease of "${units.label(unit)}"; release it as a target with an exact version first`);
			}
			types.set(unit, 'prerelease');
		} else if (!triggered.has(unit)) {
			next.set(unit, semver.inc(unit.version, 'patch'));
			types.set(unit, 'patch');
		}
	}

	for (let unit of dependents) {
		if (next.has(unit)) continue;
		let ids = new Set<string>();
		let seen = new Set<Unit>([unit]);
		let queue = [...unit.deps].filter(dep => selected.has(dep));
		for (let dep = queue.pop(); dep; dep = queue.pop()) {
			if (seen.has(dep)) continue;
			seen.add(dep);
			let fixed = seeds.has(dep) ? next.get(dep) : pre(dep.version) ? dep.version : undefined;
			let id = fixed && semver.preid(fixed);
			if (fixed && id && pre(fixed)) ids.add(id);
			queue.push(...[...dep.deps].filter(other => selected.has(other)));
		}
		let id = ids.size === 1 ? [...ids][0] : input.preid ?? input.base;
		next.set(unit, semver.inc(unit.version, 'prepatch', id));
		types.set(unit, 'prepatch');
	}

	let picks = units.order([...selected], unit => unit.name ?? '', unit => unit.deps).map(unit => ({
		unit,
		reason: seeds.get(unit) ?? 'dependent',
		type: types.get(unit) ?? 'patch',
		from: unit.version,
		to: next.get(unit) ?? unit.version,
	}));

	for (let pick of picks) {
		if (semver.compare(pick.to, pick.from) <= 0) {
			throw new Error(`The next version of "${units.label(pick.unit)}" must be greater than ${pick.from}, but is ${pick.to}`);
		}
	}

	return picks;
}

/**
 * The members of `unit` in release order.
 * @example members(unit) //=> [platform, core]
 */
export function members(unit: Unit): Package[] {
	let byKey = new Map(unit.members.map(pkg => [units.key(pkg), pkg]));
	let deps = (pkg: Package) => pkg.deps
		.filter(dep => dep.kind === 'runtime')
		.map(dep => byKey.get(units.key({ ecosystem: pkg.ecosystem, name: dep.name })))
		.filter(dep => dep !== undefined);
	return units.order(unit.members, pkg => pkg.name, deps);
}

/**
 * Each range that lists a member of a picked unit, with its new value, once per file and path.
 * @example ranges(packages, picks) //=> [{ file: '…/package.json', path: ['dependencies', 'core'], from: '^1.0.0', to: '^1.1.0', … }]
 */
export function ranges(packages: Package[], picks: Pick[]): (Package.Range & { to: string })[] {
	let next = new Map<string, string>();
	for (let pick of picks) for (let pkg of pick.unit.members) next.set(units.key(pkg), pick.to);

	let seen = new Set<string>();
	let output: (Package.Range & { to: string })[] = [];
	for (let pkg of packages) {
		for (let range of pkg.ranges) {
			let version = next.get(units.key({ ecosystem: pkg.ecosystem, name: range.dependency }));
			let id = JSON.stringify([range.file, range.path]);
			if (!version || seen.has(id)) continue;
			seen.add(id);
			let to = semver.range(range.from, version);
			if (to !== range.from) output.push({ ...range, to });
		}
	}

	return output.sort((a, b) => a.file.localeCompare(b.file) || JSON.stringify(a.path).localeCompare(JSON.stringify(b.path)));
}
