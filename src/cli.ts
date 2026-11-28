#!/usr/bin/env bun
import { parseArgs } from 'node:util';

import pkg from '../package.json' with { type: 'json' };

import * as bump from './index';
import * as paint from './paint';

const HELP = `
  Usage
    bump <type | version> [...targets] [options]

  Types
    major, minor, patch, premajor, preminor, prepatch, prerelease
    or an exact version, for example 2.0.0

  Options
    -A, --all            Release every unit, changed or not
        --preid <id>     Preid for a new prerelease line  (default: "preid" of bump.json, else next)
        --adopt          Release units that have no tag, as changed
    -D, --dryrun         Print the release, and write nothing
    -q, --quiet          Print only the new tags, and problems
        --json           Print the result as JSON on stdout
    -C, --cwd <dir>      Directory to start from  (default .)
    -v, --version        Print the version
    -h, --help           Print this message

  Examples
    bump patch
    bump minor --dryrun
    bump prerelease --preid rc
    bump 2.0.0 @acme/cli
`;

for (let stream of [process.stdout, process.stderr]) {
	stream.on('error', err => {
		if (Reflect.get(err, 'code') !== 'EPIPE') throw err;
	});
}

let argv = process.argv.slice(2);

if (argv.some(arg => arg === '-h' || arg === '--help')) {
	process.stdout.write(HELP + '\n');
	process.exit(0);
}

if (argv.some(arg => arg === '-v' || arg === '--version')) {
	process.stdout.write(`${pkg.name}, v${pkg.version}\n`);
	process.exit(0);
}

let { FORCE_COLOR, NO_COLOR } = process.env;
let color = FORCE_COLOR !== undefined ? FORCE_COLOR !== '0' : !NO_COLOR && !!process.stdout.isTTY && !!process.stderr.isTTY;

let fail = (message: string, code = 1): never => {
	process.stderr.write(paint.block(paint.palette(color), 'FAIL', message).join('\n') + '\n');
	process.exit(code);
};

let parsed = (() => {
	try {
		return parseArgs({
			args: argv,
			allowPositionals: true,
			strict: true,
			options: {
				all: { type: 'boolean', short: 'A' },
				preid: { type: 'string' },
				adopt: { type: 'boolean' },
				dryrun: { type: 'boolean', short: 'D' },
				json: { type: 'boolean' },
				quiet: { type: 'boolean', short: 'q' },
				cwd: { type: 'string', short: 'C' },
			},
		});
	} catch (err) {
		let message = err instanceof Error ? err.message : String(err);
		let code = Reflect.get(Object(err), 'code');
		let option = /(--[\w-]+)/.exec(message)?.[1] ?? /'(-[^']+)'/.exec(message)?.[1] ?? '';
		if (code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') fail(`Unknown option "${/'([^']+)'/.exec(message)?.[1] ?? option}"`);
		if (code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE' && message.includes('does not take an argument')) fail(`Option ${option} takes no value`);
		if (code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE') fail(`Missing value for ${option}`);
		return fail(message);
	}
})();

let { values, positionals } = parsed;
let [type = '', ...targets] = positionals;
let json = !!values.json;
let quiet = !!values.quiet;

try {
	let result = await bump.version(type, {
		cwd: values.cwd,
		targets,
		all: values.all,
		preid: values.preid,
		adopt: values.adopt,
		dryrun: values.dryrun,
		color: color && !json,
		log: (line, kind) => {
			if (quiet && kind !== 'warn') return;
			(json || kind === 'warn' ? process.stderr : process.stdout).write(line + '\n');
		},
	});
	if (json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
	else if (quiet && result.commit) process.stdout.write(result.units.map(unit => unit.tag).join('\n') + '\n');
} catch (err) {
	let signal = err instanceof bump.Interrupt ? err.signal : undefined;
	fail(err instanceof Error ? err.message : String(err), signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1);
}
