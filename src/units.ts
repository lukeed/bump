import * as semver from './semver';

import type { Config } from './config';
import type { Package } from './find';

export type Unit = {
	/** The group or package name, none in lockstep mode. */
	name?: string;
	members: Package[];
	/** The manifest version that every member shares. */
	version: string;
	/** Matches a whole tag of this unit, and captures its version. */
	pattern: RegExp;
	/** The units that a member depends on at runtime. */
	deps: Set<Unit>;
};

/**
 * The name of `unit` in messages.
 * @example label(unit) //=> '(lockstep)'
 */
export function label(unit: Unit): string {
	return unit.name ?? '(lockstep)';
}

/**
 * The tag of `unit` at `version`.
 * @example tag(config, unit, '1.2.0') //=> 'app@1.2.0'
 */
export function tag(config: Config, unit: Unit, version: string): string {
	return config.tag.replaceAll('{name}', () => unit.name ?? '').replaceAll('{version}', () => version);
}

/**
 * The key of a package among the packages of its ecosystem.
 * @example key(pkg) //=> 'npm:@acme/cli'
 */
export function key(pkg: { ecosystem: string; name: string }): string {
	return `${pkg.ecosystem}:${pkg.name}`;
}

/**
 * Sort `items` so that each comes after its dependencies, by smallest name first; a cycle continues at its smallest name.
 * @example order(units, unit => unit.name ?? '', unit => unit.deps)
 */
export function order<T>(items: T[], name: (item: T) => string, deps: (item: T) => Iterable<T>): T[] {
	let pending = new Set(items);
	let output: T[] = [];
	let first = (list: T[]) => list.reduce((a, b) => name(b) < name(a) ? b : a);
	while (pending.size) {
		let list = [...pending];
		let ready = list.filter(item => [...deps(item)].every(dep => dep === item || !pending.has(dep)));
		let next = first(ready.length ? ready : list);
		pending.delete(next);
		output.push(next);
	}
	return output;
}

/**
 * Group the versioned `packages` into release units, by the mode and groups of `config`.
 * @example let list = build(config, packages);
 */
export function build(config: Config, packages: Package[]): Unit[] {
	let versioned = packages.filter(pkg => pkg.version);
	let byName = new Map(packages.map(pkg => [pkg.name, pkg]));
	let sets = new Map<string | undefined, Package[]>();

	if (!config.independent) {
		sets.set(undefined, versioned);
	} else {
		let owner = new Map<Package, string>();

		for (let [name, list] of Object.entries(config.groups)) {
			let members = list.map(member => {
				let pkg = byName.get(member);
				if (!pkg) throw new Error(`Unknown package "${member}" in group "${name}"`);
				if (!pkg.version) throw new Error(`Package "${member}" in group "${name}" has no version`);
				let other = owner.get(pkg);
				if (other) throw new Error(`Package "${member}" is in groups "${other}" and "${name}"`);
				owner.set(pkg, name);
				return pkg;
			});
			let same = byName.get(name);
			if (same && !members.includes(same)) throw new Error(`Group "${name}" has the name of a package that is not its member`);
			sets.set(name, members);
		}

		let shared = new Map<string, Package[]>();
		for (let pkg of versioned) {
			if (pkg.inherits) shared.set(pkg.inherits, [...shared.get(pkg.inherits) ?? [], pkg]);
		}

		for (let [workspace, crates] of shared) {
			if (crates.length < 2) continue;
			let names = crates.map(crate => `"${crate.name}"`).join(', ');
			let groups = [...new Set(crates.map(crate => owner.get(crate)).filter(name => name !== undefined))];
			if (groups.length > 1) throw new Error(`Crates ${names} share [workspace.package] version, but are in groups "${groups.join('" and "')}"`);

			let name = groups[0] ?? crates.find(crate => crate.dir === workspace)?.name;
			if (!name) {
				throw new Error(`Crates ${names} share [workspace.package] version; name them in "groups", e.g. "groups": { "<name>": ["${crates[0].name}"] }`);
			}
			let rest = crates.filter(crate => !owner.has(crate));
			for (let crate of rest) owner.set(crate, name);
			sets.set(name, [...sets.get(name) ?? [], ...rest]);
		}

		for (let pkg of versioned) {
			if (!owner.has(pkg)) sets.set(pkg.name, [pkg]);
		}
	}

	let units: Unit[] = [...sets].map(([name, members]) => {
		let versions = [...new Set(members.map(pkg => pkg.version?.value))];
		if (versions.length > 1) {
			let list = members.map(pkg => `\n${pkg.name}  ${pkg.version?.value}`).join('');
			throw new Error(`The members of ${name ? `"${name}"` : 'the release'} must share one version:${list}`);
		}

		let escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		let source = escape(config.tag).replaceAll(escape('{name}'), () => escape(name ?? ''));
		let marker = escape('{version}');
		let at = source.indexOf(marker);
		source = source.slice(0, at) + `(${semver.PATTERN})` + source.slice(at + marker.length).replaceAll(marker, () => '\\1');

		return { name, members, version: String(versions[0]), pattern: new RegExp(`^${source}$`), deps: new Set<Unit>() };
	});

	let unitOf = new Map<string, Unit>();
	for (let unit of units) for (let pkg of unit.members) unitOf.set(key(pkg), unit);

	return units.map(unit => {
		let deps = new Set<Unit>();
		for (let pkg of unit.members) {
			for (let dep of pkg.deps) {
				let other = dep.kind === 'runtime' ? unitOf.get(key({ ecosystem: pkg.ecosystem, name: dep.name })) : undefined;
				if (other && other !== unit) deps.add(other);
			}
		}
		return Object.assign(unit, { deps });
	});
}
