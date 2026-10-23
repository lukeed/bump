export type Dict<T> = Record<string, T>;

export type Manifest = {
	name: string;
	version: string;
	private?: boolean | string;
	dependencies?: Dict<string>;
	devDependencies?: Dict<string>;
	peerDependencies?: Dict<string>;
	optionalDependencies?: Dict<string>;
};

export type Package = {
	name: string;
	/** The real path of the package folder. */
	dir: string;
	/** The path of its `package.json` file. */
	file: string;
	contents: Manifest;
};

export type Graph = Map<Package['name'], Package>;

export type Config = {
	/** The version of the last release. */
	version: string;
	/** The message of the release commit and tag. @default 'v{VERSION}' */
	message?: string;
	/** Folders that hold packages, relative to `bump.json`. @default 'packages' */
	packages?: string | string[];
	/** The folder of `bump.json` is the only package. */
	single?: boolean;
	/** Bump every package on each release, changed or not. @default false */
	all?: boolean;
};

export type Version = 'major' | 'minor' | 'patch' | 'premajor' | 'preminor' | 'prepatch';

export type Options = {
	/** The folder to find `bump.json` from. @default '.' */
	cwd?: string;
	/** Print the changes, and write nothing. @default false */
	dryrun?: boolean;
	/** Bump every package, changed or not. @default `all` of bump.json */
	all?: boolean;
};

/**
 * Bump the packages that changed since the last release, and the packages that depend on them.
 * Then commit the files and add a `v{VERSION}` tag.
 * @example await version('minor', { cwd: 'repo' });
 */
export function version(type: Version, options?: Options): Promise<void>;
