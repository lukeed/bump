import * as fs from 'fs';
import { join } from 'path';
import { suite } from 'uvu';
import * as assert from 'uvu/assert';
import * as utils from '../src/utils';

const exists = suite('exists');

exists('should be a function', () => {
	assert.type(utils.exists, 'function');
});

exists('should return `true` when item exists', () => {
	assert.is(utils.exists(__filename), true, 'file');
	assert.is(utils.exists(__dirname), true, 'directory');
});

exists('should return `false` when item does not exist', () => {
	assert.is(utils.exists(join(__dirname, 'hello')), false);
	assert.is(utils.exists(join(__dirname, 'hello.txt')), false);
});

exists.run();

// ---

const exec = suite('exec');

exec('should be a function', () => {
	assert.type(utils.exec, 'function');
});

exec.run();

// ---

const write = suite('write');

write('should be a function', () => {
	assert.type(utils.write, 'function');
});

write('should write a new file with given data', async () => {
	const file = join(__dirname, 'foobar.txt');

	try {
		await utils.write(file, 'hello there');
		assert.ok(utils.exists(file), '~> file now exists');

		let output = fs.readFileSync(file, 'utf8');
		assert.is(output, 'hello there', '~> has given data');
	} finally {
		fs.unlinkSync(file);
	}
});

write.run();

// ---

const bump = suite('bump');

bump('should be a function', () => {
	assert.type(utils.bump, 'function');
});

bump('throws on invalid format', () => {
	assert.throws(() => utils.bump('', 'patch'));
	assert.throws(() => utils.bump('1.', 'patch'));
	assert.throws(() => utils.bump('0.0', 'patch'));
});

bump('throws on invalid value segment', () => {
	assert.throws(() => utils.bump('0.0.a', 'patch'));
	assert.throws(() => utils.bump('0.!.1', 'minor'));
	assert.throws(() => utils.bump('$.1.1', 'major'));
});

bump('should handle "major" bump', () => {
	assert.is(utils.bump('0.0.0', 'major'), '1.0.0');
	assert.is(utils.bump('1.13.45', 'major'), '2.0.0');
	assert.is(utils.bump('9.0.1234', 'major'), '10.0.0');
	assert.is(utils.bump('99.91.919', 'major'), '100.0.0');

	assert.is(utils.bump('1.0.0-next.1', 'major'), '1.0.0');
	assert.is(utils.bump('3.0.0-beta.9', 'major'), '3.0.0');
});

bump('should handle "minor" bump', () => {
	assert.is(utils.bump('0.0.0', 'minor'), '0.1.0');
	assert.is(utils.bump('1.13.45', 'minor'), '1.14.0');
	assert.is(utils.bump('9.9.1234', 'minor'), '9.10.0');
	assert.is(utils.bump('99.91.919', 'minor'), '99.92.0');

	assert.is(utils.bump('1.2.0-next.12', 'minor'), '1.2.0');
	assert.is(utils.bump('3.12.0-beta.9', 'minor'), '3.12.0');
});

bump('should handle "patch" bump', () => {
	assert.is(utils.bump('0.0.0', 'patch'), '0.0.1');
	assert.is(utils.bump('1.13.45', 'patch'), '1.13.46');
	assert.is(utils.bump('9.9.1234', 'patch'), '9.9.1235');
	assert.is(utils.bump('99.91.919', 'patch'), '99.91.920');

	assert.is(utils.bump('1.2.1-next.1', 'patch'), '1.2.1');
	assert.is(utils.bump('3.2.1-beta.9', 'patch'), '3.2.1');
});

bump('should handle "premajor" bump', () => {
	assert.is(utils.bump('0.0.0', 'premajor'), '1.0.0-next.0');
	assert.is(utils.bump('1.13.45', 'premajor'), '2.0.0-next.0');

	assert.is(utils.bump('1.0.0-next.0', 'premajor'), '1.0.0-next.1');
	assert.is(utils.bump('2.0.0-next.99', 'premajor'), '2.0.0-next.100');
	// assert.is(utils.bump('1.2.0-next.99', 'premajor'), '2.0.0-next.0');
});

bump('should handle "preminor" bump', () => {
	assert.is(utils.bump('0.0.0', 'preminor'), '0.1.0-next.0');
	assert.is(utils.bump('1.13.45', 'preminor'), '1.14.0-next.0');

	assert.is(utils.bump('0.1.0-next.0', 'preminor'), '0.1.0-next.1');
	assert.is(utils.bump('1.13.0-next.0', 'preminor'), '1.13.0-next.1');
	assert.is(utils.bump('1.2.0-next.99', 'preminor'), '1.2.0-next.100');
});

bump('should handle "prepatch" bump', () => {
	assert.is(utils.bump('0.0.0', 'prepatch'), '0.0.1-next.0');
	assert.is(utils.bump('1.13.45', 'prepatch'), '1.13.46-next.0');

	assert.is(utils.bump('0.0.1-next.0', 'prepatch'), '0.0.1-next.1');
	assert.is(utils.bump('1.13.46-next.0', 'prepatch'), '1.13.46-next.1');
	assert.is(utils.bump('1.2.1-next.99', 'prepatch'), '1.2.1-next.100');
});

bump.run();
