export type Paint = {
	bold(text: string): string;
	dim(text: string): string;
	blue(text: string): string;
	green(text: string): string;
	yellow(text: string): string;
	red(text: string): string;
	magenta(text: string): string;
};

/**
 * The ANSI styles, or plain text when `color` is false.
 * @example palette(true).green('1.1.0') //=> '\x1b[32m1.1.0\x1b[39m'
 */
export function palette(color: boolean): Paint {
	let wrap = (open: number, close: number) => (text: string) => color ? `\x1b[${open}m${text}\x1b[${close}m` : text;
	return {
		bold: wrap(1, 22),
		dim: wrap(2, 22),
		blue: wrap(34, 39),
		green: wrap(32, 39),
		yellow: wrap(33, 39),
		red: wrap(31, 39),
		magenta: wrap(35, 39),
	};
}

/**
 * A WARN or FAIL message: the label and the first line, then a gutter before each other line.
 * @example block(palette(false), 'WARN', 'Dirty tree:\n M a.js') //=> ['WARN Dirty tree:', '│     M a.js']
 */
export function block(p: Paint, label: 'WARN' | 'FAIL', message: string): string[] {
	let tint = label === 'WARN' ? p.yellow : p.red;
	let [first, ...rest] = message.split('\n');
	return [
		`${tint(p.bold(label))} ${first}`,
		...rest.map(line => (tint('│') + (line ? `    ${line}` : '')).trimEnd()),
	];
}
