import { existsSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import * as anchor from './anchor';
import * as cargo from './cargo';
import * as config from './config';
import * as edit from './edit';
import * as find from './find';
import * as git from './git';
import * as lockfile from './lockfile';
import * as plan from './plan';
import * as release from './release';
import * as semver from './semver';
import * as units from './units';

import type { Options, Result, Type } from '..';
import type { Change } from './edit';
import type { Package } from './find';
import type { Pick } from './plan';
import type { Unit } from './units';

export { Interrupt } from './release';

const TYPES: Type[] = ['major', 'minor', 'patch', 'premajor', 'preminor', 'prepatch', 'prerelease'];

/**
 * Release the units that changed since their last tag, and the units that depend on them.
 * Then commit the files and add one annotated tag per unit.
 * @example let result = await version('minor', { cwd: 'repo' });
 */
export async function version(input: Type | string, options: Options = {}): Promise<Result> {
	let log = options.log ?? (() => {});
	let warn = (message: string) => log(`warning: ${message}`);

	let raw = input.trim();
	let type = TYPES.find(name => name === raw.toLowerCase());
	let exact: string | undefined;
	if (!type) {
		if (!raw) throw new Error('Missing <type> argument');
		let parsed = semver.parse(raw);
		if (!parsed || parsed.build !== undefined) throw new Error(`Invalid <type> argument: "${raw}"`);
		exact = raw;
	}

	let targets = options.targets ?? [];
	if (options.all && targets.length) throw new Error('Cannot combine --all with targets');
	if (options.preid !== undefined) {
		if (exact || type === 'major' || type === 'minor' || type === 'patch') throw new Error(`Cannot use --preid with "${raw}"`);
		if (!semver.identifier(options.preid)) throw new Error(`Invalid --preid value: "${options.preid}"`);
	}

	let conf = await config.load(options.cwd ?? '.');
	if (targets.length && !conf.independent) throw new Error('Targets need "independent": true in bump.json');

	let { top, root } = conf;
	let rel = (path: string) => relative(top, path).split(sep).join('/') || '.';

	let head = await git.head(top);
	if (!head) throw new Error('The repository has no commits');
	if (await git.shallow(top)) {
		throw new Error('A full clone is needed: the history and tags are used to find changes (in CI, fetch all history and tags)');
	}

	let packages = find.packages(conf, warn);
	let list = units.build(conf, packages);

	let chosen: Set<Unit> | undefined;
	if (targets.length) {
		chosen = new Set();
		let unknown: string[] = [];
		for (let name of targets) {
			let unit = list.find(unit => unit.name === name) ?? list.find(unit => unit.members.some(pkg => pkg.name === name));
			if (unit) chosen.add(unit);
			else if (packages.some(pkg => pkg.name === name)) throw new Error(`Package "${name}" has no version, so it cannot be a target`);
			else unknown.push(name);
		}
		if (unknown.length) throw new Error(`Unknown targets: ${unknown.map(name => `"${name}"`).join(', ')}`);
	}

	let scope = plan.scope(list, chosen);
	let states = await anchor.resolve(conf, scope);
	let changed = await anchor.changed(conf, packages, list, states);

	let request: plan.Input = {
		units: list,
		independent: conf.independent,
		targets: chosen,
		states,
		changed,
		type,
		exact,
		all: !!options.all,
		adopt: !!options.adopt,
		preid: options.preid,
		base: conf.preid,
	};

	let missing = units.order(scope, unit => unit.name ?? '', unit => unit.deps).filter(unit => states.get(unit)?.kind === 'missing');
	if (missing.length && !options.adopt) {
		let width = Math.max(...missing.map(unit => units.label(unit).length));
		let lines = [
			`no tag found for ${missing.length} ${missing.length === 1 ? 'unit' : 'units'} whose manifests are past 0.0.0`,
			'',
			...missing.map(unit => `  ${units.label(unit).padEnd(width)}   manifest ${unit.version}   expected tag ${units.tag(conf, unit, unit.version)}`),
			'',
			'To continue from the last release, tag the commit that released it:',
			...missing.map(unit => {
				let name = units.tag(conf, unit, unit.version);
				return `  git tag -a ${name} -m ${name} <commit>`;
			}),
		];
		try {
			let preview = plan.plan({ ...request, adopt: true });
			let args = [raw, ...targets, ...options.all ? ['--all'] : [], ...options.preid ? ['--preid', options.preid] : [], ...options.dryrun ? ['--dryrun'] : [], '--adopt'];
			let summary = preview.map(pick => pick.unit.name ? `${pick.unit.name} ${pick.to}` : pick.to).join(', ');
			lines.push('', 'To use the manifest versions as the base, run again with --adopt:', `  bump ${args.join(' ')}   →   ${summary}`);
		} catch {}
		throw new Error(lines.join('\n'));
	}

	let picks = plan.plan(request);
	let result: Result = { dryrun: !!options.dryrun, type: exact ? 'exact' : type ?? 'patch', commit: null, message: null, units: [], ranges: [], files: [] };

	if (!picks.length) {
		log('nothing to release');
		return result;
	}

	let tags = picks.map(pick => units.tag(conf, pick.unit, pick.to));
	let existing = new Set(await git.tags(top));
	let taken = tags.filter(name => existing.has(name));
	if (taken.length) throw new Error(`These tags already exist: ${taken.map(name => `"${name}"`).join(', ')}`);
	for (let name of tags) {
		if (!(await git.ok(top, ['check-ref-format', `refs/tags/${name}`]))) throw new Error(`Invalid tag name: "${name}"`);
	}

	let ranges = plan.ranges(packages, picks);
	let changes = new Map<string, Change[]>();
	let push = (file: string, change: Change) => {
		let list = changes.get(file) ?? [];
		let id = JSON.stringify(change.path);
		if (!list.some(item => JSON.stringify(item.path) === id)) changes.set(file, [...list, change]);
	};

	for (let pick of picks) {
		for (let pkg of pick.unit.members) {
			if (pkg.version) push(pkg.version.file, { path: pkg.version.path, value: pick.to });
		}
	}
	for (let range of ranges) push(range.file, { path: range.path, value: range.to });
	for (let [file, change] of await locks(top, picks)) push(file, change);

	let edits = new Map<string, string>();
	for (let [file, list] of changes) edits.set(file, edit.edit(file, readFileSync(file, 'utf8'), list));

	let npm = picks.some(pick => pick.unit.members.some(pkg => pkg.ecosystem === 'npm')) || ranges.some(range => range.file.endsWith('package.json'));
	let locked = npm ? await lockfile.find(root, top, warn) : [];

	let dirty = await git.dirty(top);
	if (dirty.length) {
		if (!options.dryrun) throw new Error(`Commit or stash the changes to tracked files first:\n${dirty.join('\n')}`);
		warn(`a release needs a clean tree; these tracked files have changes:\n${dirty.join('\n')}`);
	}
	let busy = await git.busy(top);
	if (busy) throw new Error(`A ${busy} is in progress; finish it first`);
	let untracked: string[] = [];
	for (let file of edits.keys()) {
		if (!(await git.tracked(top, file))) untracked.push(rel(file));
	}
	if (untracked.length) throw new Error(`These files are not tracked by git: ${untracked.map(file => `"${file}"`).join(', ')}`);

	let message = conf.message.replaceAll('{version}', () => picks[0].to).replaceAll('{tags}', () => tags.join(', '));

	result.message = message;
	result.units = picks.map((pick, index) => ({
		name: pick.unit.name ?? null,
		type: pick.type,
		tag: tags[index],
		from: pick.from,
		to: pick.to,
		reason: pick.reason,
		packages: plan.members(pick.unit).map(pkg => ({ name: pkg.name, ecosystem: pkg.ecosystem, dir: rel(pkg.dir), publish: pkg.publish })),
	}));
	result.ranges = ranges.map(range => ({
		file: rel(range.file),
		package: range.package ?? null,
		dependency: range.dependency,
		field: range.field,
		from: range.from,
		to: range.to,
	}));

	for (let unit of result.units) {
		log(`~> ${unit.name ? `${unit.name} ` : ''}${unit.from} → ${unit.to} (${unit.reason})`);
		if (unit.packages.length > 1 || unit.packages[0].name !== unit.name) log(`     ${unit.packages.map(pkg => pkg.name).join(', ')}`);
	}
	for (let range of result.ranges) {
		log(`~> ${range.package ?? range.file} ${range.field}["${range.dependency}"]: ${range.from} → ${range.to}`);
	}

	if (options.dryrun) {
		result.files = [...new Set([...edits.keys(), ...locked.map(lock => lock.file)].map(rel))].sort();
		log('dry run: no files were written');
		return result;
	}

	let output = await release.release({ top, root, head, edits, locks: locked, message, tags });
	result.commit = output.commit;
	result.files = output.files;
	log(`release: ${message} (${await git.run(top, ['rev-parse', '--short', output.commit])})`);
	return result;
}

/**
 * The `Cargo.lock` changes for the released crates, in each tracked lockfile.
 */
async function locks(top: string, picks: Pick[]): Promise<[string, Change][]> {
	let byLock = new Map<string, Map<string, Pick>>();
	for (let pick of picks) {
		for (let pkg of pick.unit.members) {
			if (pkg.ecosystem !== 'cargo' || !pkg.lock) continue;
			byLock.set(pkg.lock, new Map([...byLock.get(pkg.lock) ?? [], [pkg.name, pick]]));
		}
	}

	let output: [string, Change][] = [];
	for (let [dir, crates] of byLock) {
		let file = join(dir, 'Cargo.lock');
		if (!existsSync(file) || !(await git.tracked(top, file))) continue;
		let entries = cargo.parse(file).package;
		if (!Array.isArray(entries)) continue;
		entries.forEach((entry: unknown, index) => {
			let item: Record<string, unknown> = entry && typeof entry === 'object' ? { ...entry } : {};
			let pick = typeof item.name === 'string' ? crates.get(item.name) : undefined;
			if (pick && item.source === undefined && item.version === pick.from) {
				output.push([file, { path: ['package', index, 'version'], value: pick.to }]);
			}
			if (!Array.isArray(item.dependencies)) return;
			item.dependencies.forEach((dep: unknown, at) => {
				let [name, version, ...rest] = typeof dep === 'string' ? dep.split(' ') : [];
				let found = name ? crates.get(name) : undefined;
				if (found && version === found.from && !rest.length) {
					output.push([file, { path: ['package', index, 'dependencies', at], value: `${name} ${found.to}` }]);
				}
			});
		});
	}
	return output;
}

export type { Package };
