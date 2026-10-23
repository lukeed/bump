import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

import * as utils from './utils';

import type { Graph, Manifest } from '..';

/**
 * Add each package in `dir` to `graph`: `dir` itself when it has a `package.json` file, else each folder in it.
 * @example let graph: Graph = new Map; collect('packages', graph);
 */
export function collect(dir: string, graph: Graph): void {
	if (!existsSync(dir)) return;

	let file = join(dir, 'package.json');

	if (existsSync(file)) {
		let { value } = utils.read<Manifest>(file);
		if (!value.name) return console.log('! missing "name" field in "%s"', file);
		if (!value.version) return console.log('! missing "version" field in "%s"', value.name);
		let other = graph.get(value.name);
		if (other) throw new Error(`Two packages are named "${value.name}": "${other.file}" and "${file}"`);
		graph.set(value.name, { name: value.name, dir: realpathSync(dir), file, contents: value });
		return;
	}

	for (let entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
		if (entry.isDirectory()) collect(join(dir, entry.name), graph);
	}
}
