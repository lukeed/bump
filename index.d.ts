export type Dict<T> = Record<string, T>;

export interface Package {
	name: string;
	public: boolean;
	deps: Set<Package['name']>;
	file: string;
	dir: string;
	contents: {
		name: string;
		version: string;
		private?: boolean | string;
		dependencies?: Dict<string>;
		devDependencies?: Dict<string>;
		peerDependencies?: Dict<string>;
	};
}

export type Graph = Map<Package['name'], Package>;

export interface Config {
	version: string;
	message?: string;
	packages?: string | string[];
	single?: boolean;
}

export type Version = 'patch' | 'minor' | 'major';

export interface Options {
	cwd?: string;
	all?: boolean;
	// dryrun?: boolean;
}

export function version(type: Version, options?: Options): Promise<void>;
