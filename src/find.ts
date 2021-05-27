import { dirname, join } from 'path';
import { exists, list, lstat } from './utils';

import type { Graph, Dict, Package } from '..';

// TODO: accept ignores
export async function collect(dir: string, graph: Graph) {
	if (!exists(dir)) return;

	let fpath = join(dir, 'package.json');

	if (exists(fpath)) {
		let cache: Set<string> = new Set;
		let name: string, dict: Dict<string> | void;
		let pkg = require(fpath) as Package['contents'];

		if (!pkg.name) {
			return console.log('! missing "name" field in "%s"', fpath);
		}

		if (!pkg.version) {
			return console.log('! missing "version" field in "%s"', pkg.name);
		}

		if (dict = pkg.dependencies)
			for (name in dict) cache.add(name);

		if (dict = pkg.devDependencies)
			for (name in dict) cache.add(name);

		if (dict = pkg.peerDependencies)
			for (name in dict) cache.add(name);

		return graph.set(pkg.name, {
			name: pkg.name,
			file: fpath,
			dir: dirname(fpath),
			contents: pkg,
			deps: cache,
		});
	}

	await list(dir).then(arr => Promise.all(
		arr.map(async str => {
			if (str !== 'node_modules') {
				let abs = join(dir, str);
				let stats = await lstat(abs);
				if (stats.isDirectory()) {
					return collect(abs, graph);
				}
			}
		})
	));
}
