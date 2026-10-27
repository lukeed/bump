import * as json from './json';
import * as toml from './toml';

export type Path = (string | number)[];

export type Span = {
	path: Path;
	/** The index of the first character inside the quotes. */
	start: number;
	/** The index of the closing quote. */
	end: number;
};

export type Change = {
	path: Path;
	value: string;
};

/**
 * Replace the string values at each `change.path` of `text`, and keep every other byte.
 * Parses the result again, and throws unless it equals the original with the changes applied.
 * @example edit('package.json', '{ "version": "1.0.0" }', [{ path: ['version'], value: '1.1.0' }]) //=> '{ "version": "1.1.0" }'
 */
export function edit(file: string, text: string, changes: Change[]): string {
	let format = file.endsWith('.json') ? json : toml;
	let parse = file.endsWith('.json') ? JSON.parse : Bun.TOML.parse;

	let spans = new Map<string, Span>();
	for (let span of format.scan(text)) spans.set(JSON.stringify(span.path), span);

	let found = changes.map(change => {
		if (/["'\\\n\r]/.test(change.value)) throw new Error(`Cannot write "${change.value}" into "${file}"`);
		let span = spans.get(JSON.stringify(change.path));
		if (!span) throw new Error(`Missing "${change.path.join('.')}" string in "${file}"`);
		return { span, value: change.value };
	}).sort((a, b) => b.span.start - a.span.start);

	let output = text;
	for (let { span, value } of found) {
		output = output.slice(0, span.start) + value + output.slice(span.end);
	}

	let expected = changes.reduce<unknown>((tree, change) => set(tree, change.path, change.value), parse(text));
	if (!Bun.deepEquals(parse(output), expected)) {
		throw new Error(`Failed to edit "${file}": the result does not match the intended changes`);
	}
	return output;
}

function set(tree: unknown, path: Path, value: string): unknown {
	if (!path.length) return value;
	let [key, ...rest] = path;
	if (Array.isArray(tree) && typeof key === 'number') {
		return tree.map((item, index) => index === key ? set(item, rest, value) : item);
	}
	if (tree && typeof tree === 'object' && typeof key === 'string') {
		return { ...tree, [key]: set(Reflect.get(tree, key), rest, value) };
	}
	throw new Error(`Missing "${path.join('.')}" path`);
}
