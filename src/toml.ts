import type { Path, Span } from './edit';

/**
 * Find the span of every one-line string value in a valid TOML `text`, inside its quotes.
 * Arrays of tables and array items use their index in the path.
 * @example scan('[package]\nversion = "1.0.0"') //=> [{ path: ['package', 'version'], start: 21, end: 26 }]
 */
export function scan(text: string): Span[] {
	let spans: Span[] = [];
	let arrays = new Map<string, number>();
	let table: Path = [];
	let i = 0;

	let blank = (lines: boolean) => {
		while (i < text.length) {
			let char = text[i];
			if (char === ' ' || char === '\t' || char === '\r' || (lines && char === '\n')) i++;
			else if (char === '#') while (i < text.length && text[i] !== '\n') i++;
			else return;
		}
	};

	let quoted = (quote: string): [number, number] => {
		let start = ++i;
		while (text[i] !== quote) {
			if (i >= text.length || text[i] === '\n') throw new Error('Unterminated TOML string');
			i += quote === '"' && text[i] === '\\' ? 2 : 1;
		}
		return [start, i++];
	};

	let key = (): string[] => {
		let keys: string[] = [];
		for (;;) {
			blank(false);
			let char = text[i];
			if (char === '"') {
				let [start, end] = quoted('"');
				keys.push(JSON.parse(text.slice(start - 1, end + 1)));
			} else if (char === "'") {
				let [start, end] = quoted("'");
				keys.push(text.slice(start, end));
			} else {
				let start = i;
				while (i < text.length && /[A-Za-z0-9_-]/.test(text[i])) i++;
				if (start === i) throw new Error(`Expected a TOML key at ${i}`);
				keys.push(text.slice(start, i));
			}
			blank(false);
			if (text[i] !== '.') return keys;
			i++;
		}
	};

	let resolve = (keys: string[]): Path => {
		let path: Path = [];
		for (let name of keys) {
			path.push(name);
			let index = arrays.get(JSON.stringify(path));
			if (index !== undefined) path.push(index);
		}
		return path;
	};

	let value = (path: Path): void => {
		blank(false);
		let char = text[i];

		if (text.startsWith('"""', i) || text.startsWith("'''", i)) {
			let close = text.slice(i, i + 3);
			i += 3;
			while (!text.startsWith(close, i)) {
				if (i >= text.length) throw new Error('Unterminated TOML string');
				i += close === '"""' && text[i] === '\\' ? 2 : 1;
			}
			i += 3;
			while (text[i] === close[0]) i++;
			return;
		}

		if (char === '"' || char === "'") {
			let [start, end] = quoted(char);
			spans.push({ path, start, end });
			return;
		}

		if (char === '[') {
			i++;
			for (let index = 0; ; index++) {
				blank(true);
				if (text[i] === ']') return void i++;
				value([...path, index]);
				blank(true);
				if (text[i] === ',') i++;
			}
		}

		if (char === '{') {
			i++;
			for (;;) {
				blank(true);
				if (text[i] === '}') return void i++;
				pair(path);
				blank(true);
				if (text[i] === ',') i++;
			}
		}

		while (i < text.length && !',]}\n#'.includes(text[i])) i++;
	};

	let pair = (base: Path) => {
		let keys = key();
		if (text[i] !== '=') throw new Error(`Expected "=" at ${i} in TOML`);
		i++;
		value([...base, ...keys]);
	};

	for (;;) {
		blank(true);
		if (i >= text.length) return spans;

		if (text.startsWith('[[', i)) {
			i += 2;
			let keys = key();
			let path = [...resolve(keys.slice(0, -1)), keys[keys.length - 1]];
			let id = JSON.stringify(path);
			let index = (arrays.get(id) ?? -1) + 1;
			arrays.set(id, index);
			table = [...path, index];
			i += 2;
		} else if (text[i] === '[') {
			i++;
			table = resolve(key());
			i++;
		} else {
			pair(table);
		}
	}
}
