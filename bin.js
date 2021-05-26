#!/usr/bin/env node
const argv = require('mri')(process.argv.slice(2), {
	default: {
		'C': '.',
		'A': false,
		'D': false,
	},
	alias: {
		'A': 'all',
		'C': 'cwd',
		'D': 'dryrun',
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
	let output = '';
	output += '\n  Usage';
	output += '\n    bump <type> [options]';
	output += '\n';
	output += '\n  Options';
	output += '\n    -A, --all        Apply version change to all packages';
	output += '\n    -C, --cwd        Directory to resolve from  (default .)';
	output += '\n    -D, --dryrun     Perform a practice run; no actions taken';
	output += '\n    -v, --version      Displays current version';
	output += '\n    -h, --help         Displays this message';
	output += '\n';
	output += '\n  Examples';
	output += '\n    bump patch';
	output += '\n    bump minor --all';
	output += '\n    bump premajor --dryrun';
	output += '\n';

	process.stdout.write(output + '\n');
	process.exit(0);
}

(async function () {
	try {
		let type = (argv._[0] || '').trim().toLowerCase();
		if (!type) throw new Error('Missing <type> argument');
		if (!/^(pre)?(major|minor|patch)$/.test(type)) throw new Error(`Invalid <type> argument: "${type}"`);

		let commands = require('.');
		await commands.version(type, argv);
	} catch (err) {
		console.error('ERROR', err.stack);
		process.exit(1);
	}
})();
