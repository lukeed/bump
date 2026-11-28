export type Type = 'major' | 'minor' | 'patch' | 'premajor' | 'preminor' | 'prepatch' | 'prerelease';

export type Ecosystem = 'npm' | 'cargo';

/** What a log line is about: the release plan, its result, or a warning. */
export type Kind = 'plan' | 'done' | 'warn';

export type Reason = 'target' | 'first' | 'adopted' | 'changed' | 'all' | 'dependent';

export type Config = {
	/** The JSON schema of this file, for editors. */
	$schema?: string;
	/**
	 * Give each package, or each group, its own version and tag.
	 * Without it, all packages share one version and one tag.
	 * @default false
	 */
	independent?: boolean;
	/**
	 * Folder globs, relative to this file. A glob that starts with "!" excludes.
	 * Without it, each ecosystem uses its workspace files, else the root folder.
	 */
	packages?: string | [string, ...string[]];
	/**
	 * Packages that always release together, with one version and one tag, by group name.
	 * Only in independent mode.
	 */
	groups?: Record<string, [string, ...string[]]>;
	/**
	 * The id of a new prerelease line.
	 * @pattern ^(?![0-9]+$)[0-9A-Za-z-]+$
	 * @default "next"
	 */
	preid?: string;
	/**
	 * The tag name. "{version}" is required; "{name}" is required in independent mode, and not allowed without it.
	 * Without it: "v{version}", or "{name}@{version}" in independent mode.
	 * @minLength 1
	 */
	tag?: string;
	/**
	 * The subject of the release commit. "{tags}" is the new tags; "{version}" works only without independent mode.
	 * Without it: "v{version}", or "release: {tags}" in independent mode.
	 * @minLength 1
	 */
	message?: string;
};

export type Options = Omit<Config, '$schema' | 'preid'> & {
	/** The folder to start from. @default '.' */
	cwd?: string;
	/** Release only these packages or groups, and their dependents. Independent mode only. */
	targets?: string[];
	/** Release every unit, changed or not. @default false */
	all?: boolean;
	/** The id of a new prerelease line. It also replaces the id of a continued line, and the `preid` of the config file. */
	preid?: string;
	/** Release units that have no tag for their manifest version, as changed. @default false */
	adopt?: boolean;
	/** Do every check, and write nothing. @default false */
	dryrun?: boolean;
	/** Receives each log line and its kind. Without it, nothing is printed. */
	log?: (line: string, kind: Kind) => void;
	/** Add ANSI colors to the log lines. @default false */
	color?: boolean;
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
