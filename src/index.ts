const fs = require('fs');
const { promisify } = require('util');
const { join, resolve } = require('path');
const escalade = require('escalade');

const NAME = 'bump.lock';
const PKG = 'package.json';

const read = promisify(fs.readFile);
const write = promisify(fs.writeFile);

// TODO: throw on no version, or omit, or default?
function build_name(name, version='*') {
	return name + '@' + version.replace('workspace:', '');
}

function parse_name(str) {
	let arr = str.split('@');
	return arr.slice(0, -1).join('@');
}

async function build(dir) {
	const graph = new Map;
	fs.readdirSync(dir).forEach(str => {
		let name, dict, cache = new Set();
		let pkg = require(join(dir, str, PKG));

		if (dict = pkg.dependencies)
			for (name in dict) cache.add(build_name(name, dict[name]));

		if (dict = pkg.devDependencies)
			for (name in dict) cache.add(build_name(name, dict[name]));

		if (dict = pkg.peerDependencies)
			for (name in dict) cache.add(build_name(name, dict[name]));

		name = build_name(pkg.name, pkg.version);
		graph.set(name, cache);
	});

	// build locals
	// link vs install
	let local_file = '';
	for (let [pkg, list] of graph) {
		let item, tmp, locals=[];
		let pkgName = parse_name(pkg);
		console.log('[%s]', pkgName);

		for (item of list) {
			if (graph.has(item)) {
				tmp = parse_name(item);
				console.log('  ~> link "%s"', tmp);
				locals.push(tmp);
			} else {
				console.log('  ~> install "%s"', item);
			}
		}

		if (locals.length > 0) {
			local_file += pkgName + '\n\t';
			local_file += locals.join('\n\t') + '\n';
		}
	}

	console.log('\n\nlocal file:');
	console.log(local_file);

	return local_file;
}

module.exports = async function (argv) {
	argv.cwd = resolve(argv.cwd || '.');

	let i=0, filename, rgx=/pnpm-workspace.ya?ml$/;
	let file = await escalade(argv.cwd, (dir, list) => {
		for (i=0; i < list.length; i++) {
			if (list[i] === NAME) return join(dir, filename=NAME);
			if (rgx.test(list[i])) return join(dir, filename=list[i]);
			if (list[i] === PKG) return join(dir, filename=PKG);
		}
	});

	if (filename === NAME) {
		// parse own file
		return;
	}

	let packages = [];

	if (file && rgx.test(filename)) {
		// parse `packages` list
	} else if (filename === PKG) {
		// parse `workspaces` list
	} else {
		throw new Error('Missing file');
	}

	// build `bump.lock` file
}
