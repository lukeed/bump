#!/usr/bin/env node
const argv = require('mri')(process.argv.slice(2), {
	default: {
		'C': '.',
	},
	alias: {
		'C': 'cwd',
		'v': 'version',
		'h': 'help',
	}
});

if (argv.v) {
	const pkg = require('./package.json');
	console.log(`${pkg.name}, v${pkg.version}`);
	process.exit(0);
}

if (argv.h) {
	console.log('TODO: print help');
	process.exit(0);
}

(async function () {
	try {
		await require('.')(argv);
	} catch (err) {
		console.error('ERROR', err.stack);
		process.exit(1);
	}
})();
