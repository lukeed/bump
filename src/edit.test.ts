import { describe, expect, test } from 'bun:test';

import * as edit from './edit';
import * as json from './json';
import * as toml from './toml';

let paths = (spans: edit.Span[], text: string) => spans.map(span => [span.path.join('.'), text.slice(span.start, span.end)]);

describe('json.scan', () => {
	test('finds nested string values, with escaped keys and a BOM', () => {
		let text = '﻿{ "a\\"b": "x", "deps": { "foo": "^1.0.0" }, "list": ["p", 1, true, null, { "q": "r" }], "n": -1.5e3 }';
		expect(paths(json.scan(text), text)).toEqual([
			['a"b', 'x'],
			['deps.foo', '^1.0.0'],
			['list.0', 'p'],
			['list.4.q', 'r'],
		]);
	});
});

describe('toml.scan', () => {
	test('finds values in tables, dotted keys, inline tables, and arrays of tables', () => {
		let text = [
			'# comment',
			'package.version = "0.1.0" # trailing',
			'[package]',
			'name = "acme"',
			"version = '1.2.0'",
			'edition = 2021',
			'[dependencies]',
			'foo = { path = "../foo", version = "1.2" }',
			'bar.version = "3"',
			'[dependencies.baz]',
			'version = "1.0.0"',
			"[target.'cfg(unix)'.dependencies]",
			'qux = "2.0.0"',
			'[target."cfg(windows)".dev-dependencies]',
			'quux = "2.0.0"',
			'[target.x86_64-unknown-linux-gnu.build-dependencies]',
			'corge = "2.0.0"',
			'[[package]]',
			'name = "a"',
			'dependencies = [',
			'  "b 1.0.0", # one',
			'  "c",',
			']',
			'[[package]]',
			'name = "b"',
			'when = 1979-05-27 07:32:00Z',
			'notes = """',
			'version = "fake"',
			'"""',
			"raw = '''x'''",
			'[package.meta]',
			'k = "v"',
		].join('\r\n');
		expect(paths(toml.scan(text), text)).toEqual([
			['package.version', '0.1.0'],
			['package.name', 'acme'],
			['package.version', '1.2.0'],
			['dependencies.foo.path', '../foo'],
			['dependencies.foo.version', '1.2'],
			['dependencies.bar.version', '3'],
			['dependencies.baz.version', '1.0.0'],
			['target.cfg(unix).dependencies.qux', '2.0.0'],
			['target.cfg(windows).dev-dependencies.quux', '2.0.0'],
			['target.x86_64-unknown-linux-gnu.build-dependencies.corge', '2.0.0'],
			['package.0.name', 'a'],
			['package.0.dependencies.0', 'b 1.0.0'],
			['package.0.dependencies.1', 'c'],
			['package.1.name', 'b'],
			['package.1.meta.k', 'v'],
		]);
	});
});

describe('edit', () => {
	test('replaces only the value in JSON, and keeps every other byte', () => {
		let text = '{\r\n\t"name": "a",\r\n\t"version": "1.0.0",\r\n\t"x": "\\u00e9", "n": 1.0,\r\n\t"dependencies": { "b": "^1.0.0" }\r\n}';
		let out = edit.edit('package.json', text, [
			{ path: ['version'], value: '1.1.0' },
			{ path: ['dependencies', 'b'], value: '^1.1.0' },
		]);
		expect(out).toBe(text.replace('"1.0.0"', '"1.1.0"').replace('"^1.0.0"', '"^1.1.0"'));
	});

	test('replaces only the value in TOML, and keeps comments and quote style', () => {
		let text = "# top\n[package]\nname = 'a' # name\nversion = '1.0.0'\n\n[dependencies]\nb = { path = \"../b\", version = \"1.0\" }";
		let out = edit.edit('Cargo.toml', text, [
			{ path: ['package', 'version'], value: '1.1.0' },
			{ path: ['dependencies', 'b', 'version'], value: '1.1' },
		]);
		expect(out).toBe(text.replace("'1.0.0'", "'1.1.0'").replace('"1.0"', '"1.1"'));
	});

	test('edits arrays of tables in a lockfile', () => {
		let text = '[[package]]\nname = "a"\nversion = "1.0.0"\ndependencies = [\n "b 1.0.0",\n]\n\n[[package]]\nname = "b"\nversion = "1.0.0"\n';
		let out = edit.edit('Cargo.lock', text, [
			{ path: ['package', 1, 'version'], value: '1.1.0' },
			{ path: ['package', 0, 'dependencies', 0], value: 'b 1.1.0' },
		]);
		expect(out).toBe('[[package]]\nname = "a"\nversion = "1.0.0"\ndependencies = [\n "b 1.1.0",\n]\n\n[[package]]\nname = "b"\nversion = "1.1.0"\n');
	});

	test('throws for a missing path or an unsafe value', () => {
		expect(() => edit.edit('package.json', '{"a":1}', [{ path: ['a'], value: '2' }])).toThrow('Missing "a" string in "package.json"');
		expect(() => edit.edit('package.json', '{"a":"1"}', [{ path: ['a'], value: '2"' }])).toThrow('Cannot write "2"" into "package.json"');
	});

	test('throws when the result does not parse to the intended value', () => {
		let changes = [{ path: ['a'], value: '22' }, { path: ['a'], value: '3' }];
		expect(() => edit.edit('Cargo.toml', 'a = "1"\n', changes)).toThrow('Failed to edit "Cargo.toml": the result does not match the intended changes');
	});
});
