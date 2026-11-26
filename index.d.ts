export type Type = 'major' | 'minor' | 'patch' | 'premajor' | 'preminor' | 'prepatch' | 'prerelease';

export type Ecosystem = 'npm' | 'cargo';

export type Reason = 'target' | 'first' | 'adopted' | 'changed' | 'all' | 'dependent';

export type Options = {
	/** The folder to start from. @default '.' */
	cwd?: string;
	/** Release only these packages or groups, and their dependents. Independent mode only. */
	targets?: string[];
	/** Release every unit, changed or not. @default false */
	all?: boolean;
	/** The id of a new prerelease line. @default `preid` of bump.json, else 'next' */
	preid?: string;
	/** Release units that have no tag for their manifest version, as changed. @default false */
	adopt?: boolean;
	/** Do every check, and write nothing. @default false */
	dryrun?: boolean;
	/** Receives each log line. Without it, nothing is printed. */
	log?: (line: string) => void;
};

export type Result = {
	dryrun: boolean;
	/** The input type, or 'exact' for an exact version. */
	type: Type | 'exact';
	/** The full SHA of the release commit. */
	commit: string | null;
	/** The subject of the release commit. */
	message: string | null;
	units: Result.Unit[];
	ranges: Result.Range[];
	/** The written files, relative to the git top level. */
	files: string[];
};

export namespace Result {
	type Unit = {
		/** The group or package name, `null` in lockstep mode. */
		name: string | null;
		type: Type | 'exact';
		tag: string;
		from: string;
		to: string;
		reason: Reason;
		packages: Package[];
	};

	type Package = {
		name: string;
		ecosystem: Ecosystem;
		/** The package folder, relative to the git top level. */
		dir: string;
		publish: boolean;
	};

	type Range = {
		file: string;
		/** The package that lists the dependency, `null` for `[workspace.dependencies]`. */
		package: string | null;
		dependency: string;
		field: string;
		from: string;
		to: string;
	};
}

/** The error of a release that stopped for a signal, after its undo. */
export class Interrupt extends Error {
	signal: 'SIGINT' | 'SIGTERM';
	constructor(signal: 'SIGINT' | 'SIGTERM');
}

/**
 * Release the units that changed since their last tag, and the units that depend on them.
 * Then commit the files and add one annotated tag per unit.
 * @example let result = await version('minor', { cwd: 'repo' });
 */
export function version(input: Type | string, options?: Options): Promise<Result>;
