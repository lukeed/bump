import { dirname, join } from 'path';
import { exists, list, lstat } from './utils';

import type { Graph, Dict, Package } from '..';

export async function collect(dir: string, graph: Graph) {
	if (!exists(dir)) return;

	await list(dir).then(arr => Promise.all(
		arr.map(async str => {
			// TODO: accept ignores
			let absolute = join(dir, str);
			if (str === 'node_modules') return;

			if (str === 'package.json') {
				let cache: Set<string> = new Set;
				let name: string, dict: Dict<string> | void;
				let pkg = require(absolute) as Package['contents'];

				if (!pkg.name) {
					return console.log('! missing "name" field in "%s"', absolute);
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

				graph.set(pkg.name, {
					name: pkg.name,
					file: absolute,
					dir: dirname(absolute),
					contents: pkg,
					deps: cache,
				});
			} else {
				let stats = await lstat(absolute);
				if (stats.isDirectory()) {
					return collect(absolute, graph);
				}
			}
		})
	));
}
