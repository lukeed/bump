import type { Type } from '..';

const NUM = String.raw`(?:0|[1-9]\d*)`;
const IDENT = String.raw`(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)`;

/** The source of a semver version without build metadata, with no anchors and no captures. */
export const PATTERN = `${NUM}\\.${NUM}\\.${NUM}(?:-${IDENT}(?:\\.${IDENT})*)?`;

const VERSION = new RegExp(`^(${NUM})\\.(${NUM})\\.(${NUM})(?:-(${IDENT}(?:\\.${IDENT})*))?(?:\\+([0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*))?$`);
const RANGE = /^(\^|~|=)?v?(?:(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?|(\d+)\.(\d+)|(\d+))$/;

export type Version = {
	major: number;
	minor: number;
	patch: number;
	/** The prerelease identifiers, empty for a stable version. */
	pre: string[];
	build?: string;
};

/**
 * Parse a strict semver 2.0 version.
 * @example parse('1.3.0-next.2') //=> { major: 1, minor: 3, patch: 0, pre: ['next', '2'] }
 */
export function parse(input: string): Version | undefined {
	let match = VERSION.exec(input);
	if (!match) return;
	return {
		major: +match[1],
		minor: +match[2],
		patch: +match[3],
		pre: match[4] ? match[4].split('.') : [],
		build: match[5],
	};
}

/**
 * Order two valid versions by semver precedence.
 * @example compare('1.3.0-next.2', '1.3.0') //=> -1
 */
export function compare(a: string, b: string): number {
	return Bun.semver.order(a, b);
}

/**
 * The first prerelease identifier of `version`, if any.
 * @example preid('1.3.0-rc.1') //=> 'rc'
 */
export function preid(version: string): string | undefined {
	return parse(version)?.pre[0];
}

/**
 * Whether `id` can name a prerelease line.
 * @example identifier('rc') //=> true
 * @example identifier('1') //=> false
 */
export function identifier(id: string): boolean {
	return /^[0-9A-Za-z-]+$/.test(id) && !/^\d+$/.test(id);
}

/**
 * The version after a `type` bump.
 * A new prerelease line uses `preid`, else `base`. A continued line keeps its own id unless `preid` differs.
 * @example inc('1.2.3', 'preminor') //=> '1.3.0-next.0'
 * @example inc('1.3.0-next.2', 'prerelease') //=> '1.3.0-next.3'
 * @example inc('1.3.0-next.2', 'prerelease', 'rc') //=> '1.3.0-rc.0'
 */
export function inc(version: string, type: Type, preid?: string, base = 'next'): string {
	let current = parse(version);
	if (!current) throw new Error(`Invalid version: "${version}"`);

	let { major, minor, patch, pre } = current;
	let id = preid ?? base;

	switch (type) {
		case 'major': return pre.length && !minor && !patch ? `${major}.0.0` : `${major + 1}.0.0`;
		case 'minor': return pre.length && !patch ? `${major}.${minor}.0` : `${major}.${minor + 1}.0`;
		case 'patch': return pre.length ? `${major}.${minor}.${patch}` : `${major}.${minor}.${patch + 1}`;
		case 'premajor': return `${major + 1}.0.0-${id}.0`;
		case 'preminor': return `${major}.${minor + 1}.0-${id}.0`;
		case 'prepatch': return `${major}.${minor}.${patch + 1}-${id}.0`;
	}

	if (!pre.length) return `${major}.${minor}.${patch + 1}-${id}.0`;

	let core = `${major}.${minor}.${patch}`;
	let [name, count, ...rest] = pre;
	if (preid && preid !== name) return `${core}-${preid}.0`;
	if (rest.length || /^\d+$/.test(name) || (count !== undefined && !/^\d+$/.test(count))) {
		throw new Error(`Cannot continue the "${version}" prerelease; use an exact version`);
	}
	return `${core}-${name}.${count === undefined ? 0 : +count + 1}`;
}

/**
 * The range `spec` with its version set to `next`, keeping its `^`, `~`, or `=` prefix and its precision.
 * A prerelease `next` always uses all three numbers. Other ranges stay as they are.
 * @example range('^1.2', '1.3.0') //=> '^1.3'
 * @example range('workspace:*', '2.0.0') //=> 'workspace:*'
 */
export function range(spec: string, next: string): string {
	let match = RANGE.exec(spec.trim());
	let version = parse(next);
	if (!match || !version) return spec;

	let prefix = match[1] ?? '';
	if (version.pre.length || match[2] !== undefined) return prefix + next;
	if (match[6] !== undefined) return `${prefix}${version.major}.${version.minor}`;
	return `${prefix}${version.major}`;
}
