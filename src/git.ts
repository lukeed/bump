import { exec } from './utils';

export function run(file: string, args: string[] = []) {
	return exec(file, args).then(x => x.stdout.trim());
}

export async function diff(tag: string, targets: string[]): Promise<string[]> {
	try {
		const args = ['diff', '--dirstat=files,0', `v${tag}`];
		if (targets.length) args.push('--', ...targets);
		const output = await run('git', args);
		return output.split(/\r?\n/g).map(str => {
			return str.split('% ')[1].replace(/[\\\/]+$/, '');
		});
	} catch (err) {
		if (err.code === 'ENOENT') {
			throw new Error('Missing `git` binary');
		} else if (err.stderr && /(bad|unknown)\s+/.test(err.stderr)) {
			throw new Error(`Missing "v${tag}" tag in \`git\` history!`);
		} else throw err;
	}
}

export async function add(files: Set<string>): Promise<void> {
	await run('git', ['add', ...files]);
}

export async function commit(tag: string, template: string): Promise<void> {
	const message = template.replace(/{VERSION}/i, tag);
	await run('git', ['commit', '--message', message]);
	await run('git', ['tag', `v${tag}`]);
}
