import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCode } from '../src/main.mjs';

function parse(file, lines) {
  const problems = [];
  const forwards = [];
  const items = parseCode(file, lines.join('\n'), problems, forwards);
  return { items, problems, forwards };
}

test('line-comment item tag with attached need tag', () => {
  const { items, problems } = parse('src.ts', [
    '// [impl:auth/login#1]',
    '// [>>utest:auth/login#1]',
    'export function login() {}',
  ]);
  assert.equal(problems.length, 0);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'impl:auth/login#1');
  assert.equal(items[0].origin, 'code');
  assert.equal(items[0].line, 1);
  assert.deepEqual(items[0].needs, ['utest:auth/login#1']);
});

test('need tag without a preceding item tag is a problem', () => {
  const { items, problems } = parse('src.ts', ['// [>>utest:a#1]']);
  assert.equal(items.length, 0);
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /no preceding item tag/);
});

test('explicit need tag attaches to the named item, not the nearest one', () => {
  const { items, problems } = parse('src.ts', [
    '// [impl:some-name#1]',
    'function fn() {',
    '  // [impl:in-between-link#1]',
    '  const x = 1;',
    '  // [impl:some-name#1>>impl:anotherFunc#1]',
    '  anotherFunc();',
    '}',
  ]);
  assert.equal(problems.length, 0);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0].needs, ['impl:anotherFunc#1']);
  assert.deepEqual(items[1].needs, []);
});

test('explicit need tag allows spaces around >>', () => {
  const { items, problems } = parse('src.ts', [
    '// [impl:a#1]',
    '// [ impl:a#1 >> utest:a#1 ]',
  ]);
  assert.equal(problems.length, 0);
  assert.deepEqual(items[0].needs, ['utest:a#1']);
});

test('explicit need tag does not move the anchor for later implicit tags', () => {
  const { items, problems } = parse('src.ts', [
    '// [impl:a#1]',
    '// [impl:b#1]',
    '// [impl:a#1>>utest:a#1]',
    '// [>>utest:b#1]',
  ]);
  assert.equal(problems.length, 0);
  assert.deepEqual(items[0].needs, ['utest:a#1']);
  assert.deepEqual(items[1].needs, ['utest:b#1']);
});

test('explicit need tag without a matching preceding item tag is a problem', () => {
  const { items, problems } = parse('src.ts', [
    '// [impl:a#1]',
    '// [impl:other#1>>utest:other#1]',
  ]);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].needs, []);
  assert.equal(problems.length, 1);
  assert.match(
    problems[0].message,
    /\[impl:other#1>>utest:other#1\] has no preceding item tag \[impl:other#1\]/,
  );
});

test('tags outside comments are ignored', () => {
  const { items } = parse('src.ts', ['const s = "[impl:a#1]";']);
  assert.equal(items.length, 0);
});

test('multi-line block comment, one tag per line', () => {
  const { items } = parse('src.ts', [
    '/*',
    ' [impl:a#1]',
    ' [>>utest:a#1]',
    '*/',
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].line, 2);
  assert.deepEqual(items[0].needs, ['utest:a#1']);
});

test('multiple tags in one comment line', () => {
  const { items } = parse('src.ts', ['// [impl:a#1] [>>utest:a#1]']);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].needs, ['utest:a#1']);
});

test('SQL uses -- comments and does not honour //', () => {
  const { items } = parse('schema.sql', [
    '-- [impl:db/schema#1]',
    "SELECT '// [impl:not-a-tag#1]';",
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'impl:db/schema#1');
});

test('forwarding tag in a comment, spaces around --> optional', () => {
  const { items, problems, forwards } = parse('src.ts', [
    '// [req:login#1 --> dsn:auth#2]',
    '// [req:logout#1-->dsn:auth#2]',
  ]);
  assert.equal(problems.length, 0);
  assert.equal(items.length, 0); // a forwarding tag defines no item
  assert.deepEqual(forwards, [
    { from: 'req:login#1', to: 'dsn:auth#2', file: 'src.ts', line: 1 },
    { from: 'req:logout#1', to: 'dsn:auth#2', file: 'src.ts', line: 2 },
  ]);
});

test('a forwarding tag does not anchor subsequent need tags', () => {
  const { items, problems } = parse('src.ts', [
    '// [req:a#1 --> dsn:b#1]',
    '// [>>utest:a#1]',
  ]);
  assert.equal(items.length, 0);
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /no preceding item tag/);
});

test('forwarding tags outside comments are ignored', () => {
  const { forwards } = parse('src.ts', ['const s = "[req:a#1 --> dsn:b#1]";']);
  assert.equal(forwards.length, 0);
});

test('Vue supports HTML comments', () => {
  const { items } = parse('Button.vue', [
    '<template>',
    '  <!-- [impl:ui/button#1] -->',
    '</template>',
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'impl:ui/button#1');
  assert.equal(items[0].line, 2);
});
