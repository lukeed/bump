#!/usr/bin/env node
const argv = require('mri')(process.argv.slice(2), {
	default: {
		'C': '.',
		'A': false,
	},
	alias: {
		'A': 'all',
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
		let type = argv._[0];
		const commands = require('.');
		await commands.version(type, argv);
	} catch (err) {
		console.error('ERROR', err.stack);
		process.exit(1);
	}
})();
