import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCode } from '../flashtrace.mjs';

function parse(file, lines) {
  const problems = [];
  const items = parseCode(file, lines.join('\n'), problems);
  return { items, problems };
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
