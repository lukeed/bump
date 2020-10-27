import { totalist } from 'totalist';
import { basename, dirname } from 'path';

import type { Graph, Dict, Package } from '..';

export async function collect(dir: string, graph: Graph) {
	await totalist(dir, (rel, absolute) => {
		if (basename(rel) !== 'package.json') return;

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
	});
}

// return Promise.all(
// 	arr.map(async str => {
// 		let temp = join(dir, str);
// 		if (str === 'node_modules') return; // TODO: ignores
// 		let stats = await lstat(temp);
// 		if (!stats.isDirectory()) return;

// 		temp = join(temp, 'package.json');
// 		if (fs.existsSync(temp)) {
// 			let cache: Set<string> = new Set;
// 			let name: string, dict: Dict<string> | void;
// 			let pkg = require(temp) as {
// 				name?: string;
// 				version?: string;
// 				private?: boolean | string;
// 				dependencies?: Dict<string>;
// 				devDependencies?: Dict<string>;
// 				peerDependencies?: Dict<string>;
// 			};

// 			if (!pkg.name) {
// 				return console.log('! missing "name" field in "%s"', temp);
// 			}

// 			if (!pkg.version) {
// 				return console.log('! missing "version" field in "%s"', pkg.name);
// 			}

// 			if (dict = pkg.dependencies)
// 				for (name in dict) cache.add(name);

// 			if (dict = pkg.devDependencies)
// 				for (name in dict) cache.add(name);

// 			if (dict = pkg.peerDependencies)
// 				for (name in dict) cache.add(name);

// 			graph.set(pkg.name, {
// 				name: pkg.name,
// 				version: pkg.version,
// 				public: String(pkg.private) !== 'true',
// 				deps: cache
// 			});
// 		}
// 	})
// );
// })
