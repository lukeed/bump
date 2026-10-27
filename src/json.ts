import type { Span } from './edit';

/**
 * Find the span of every string value in a valid JSON `text`, inside its quotes.
 * @example scan('{"version":"1.0.0"}') //=> [{ path: ['version'], start: 12, end: 17 }]
 */
export function scan(text: string): Span[] {
	let spans: Span[] = [];
	let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;

	let space = () => {
		while (i < text.length && ' \t\r\n'.includes(text[i])) i++;
	};

	let string = (): [number, number] => {
		let start = ++i;
		while (text[i] !== '"') {
			if (i >= text.length) throw new Error('Unterminated JSON string');
			i += text[i] === '\\' ? 2 : 1;
		}
		return [start, i++];
	};

	let expect = (char: string) => {
		space();
		if (text[i] !== char) throw new Error(`Expected "${char}" at ${i} in JSON`);
		i++;
	};

	let value = (path: Span['path']): void => {
		space();
		let char = text[i];

		if (char === '"') {
			let [start, end] = string();
			spans.push({ path, start, end });
			return;
		}

		if (char === '{' || char === '[') {
			let close = char === '{' ? '}' : ']';
			i++;
			space();
			if (text[i] === close) return void i++;
			for (let index = 0; ; index++) {
				let key: string | number = index;
				if (close === '}') {
					space();
					let [start, end] = string();
					key = JSON.parse(text.slice(start - 1, end + 1));
					expect(':');
				}
				value([...path, key]);
				space();
				if (text[i] === ',') {
					i++;
					continue;
				}
				return expect(close);
			}
		}

		while (i < text.length && !' \t\r\n,]}'.includes(text[i])) i++;
	};

	value([]);
	return spans;
}
