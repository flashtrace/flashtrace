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
    /\[impl:other#1 >> utest:other#1\] has no preceding item tag \[impl:other#1\]/,
  );
});

test('a need tag may reference a wildcard revision', () => {
  const { items, problems } = parse('src.ts', [
    '// [impl:a#1]',
    '// [>>utest:a#2.x]',
    '// [impl:a#1 >> utest:b#2.3.x]',
  ]);
  assert.equal(problems.length, 0);
  assert.deepEqual(items[0].needs, ['utest:a#2.x', 'utest:b#2.3.x']);
});

test('a wildcard revision is not accepted in an item tag', () => {
  const { items } = parse('src.ts', ['// [impl:a#2.x]']);
  assert.equal(items.length, 0);
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

test('non-nesting block comment (.ts) closes at the first */', () => {
  const { items } = parse('src.ts', [
    '/* [impl:a#1] /* still-comment */ [impl:code-not-tag#1] */',
  ]);
  assert.deepEqual(items.map((i) => i.id), ['impl:a#1']);
});

test('nested block comments (Rust) close only at the matching */', () => {
  const { items } = parse('lib.rs', [
    '/* [impl:outer#1] /* [impl:inner#1] */ [impl:still#1] */',
    'let x = "[impl:code-not-tag#1]";',
  ]);
  assert.deepEqual(
    items.map((i) => i.id),
    ['impl:outer#1', 'impl:inner#1', 'impl:still#1'],
  );
});

test('nested block comment spanning multiple lines (Swift)', () => {
  const { items } = parse('View.swift', [
    '/* [impl:a#1]',
    '   /* nested',
    '   [impl:b#1] */',
    '   [impl:c#1]',
    '*/',
    'let d = 1 // [impl:e#1]',
  ]);
  assert.deepEqual(
    items.map((i) => i.id),
    ['impl:a#1', 'impl:b#1', 'impl:c#1', 'impl:e#1'],
  );
});

test('SQL uses -- comments and does not honour //', () => {
  const { items } = parse('schema.sql', [
    '-- [impl:db/schema#1]',
    "SELECT '// [impl:not-a-tag#1]';",
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'impl:db/schema#1');
});

test('hash-comment languages (Python) recognise # tags', () => {
  const { items } = parse('app.py', [
    '# [impl:app/main#1]',
    'x = "// [impl:not-a-tag#1]"  # not a comment tag context',
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'impl:app/main#1');
});

test('C-like extras (Go) use // and /* */', () => {
  const { items } = parse('main.go', [
    '// [impl:svc/run#1]',
    '/* [>>utest:svc/run#1] */',
  ]);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].needs, ['utest:svc/run#1']);
});

test('Lua uses -- line and --[[ ]] block comments', () => {
  const { items } = parse('mod.lua', [
    '-- [impl:lua/mod#1]',
    '--[[ [>>utest:lua/mod#1] ]]',
  ]);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].needs, ['utest:lua/mod#1']);
});

test('PowerShell uses # line and <# #> block comments', () => {
  const { items } = parse('deploy.ps1', [
    '# [impl:ops/deploy#1]',
    '<# [>>utest:ops/deploy#1] #>',
  ]);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].needs, ['utest:ops/deploy#1']);
});

test('CSS honours /* */ but not //', () => {
  const { items } = parse('theme.css', [
    '/* [impl:ui/theme#1] */',
    '// [impl:not-a-tag#1]',
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'impl:ui/theme#1');
});

test('semicolon-comment languages (Clojure) recognise ; tags', () => {
  const { items } = parse('core.clj', ['; [impl:app/core#1]']);
  assert.deepEqual(items.map((i) => i.id), ['impl:app/core#1']);
});

test('percent-comment languages (Erlang) recognise % tags', () => {
  const { items } = parse('mod.erl', ['% [impl:erl/mod#1]']);
  assert.deepEqual(items.map((i) => i.id), ['impl:erl/mod#1']);
});

test('OCaml uses (* *) block comments', () => {
  const { items } = parse('m.ml', ['(* [impl:ml/m#1] [>>utest:ml/m#1] *)']);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].needs, ['utest:ml/m#1']);
});

test('Pascal recognises both { } and (* *) block comments', () => {
  const { items } = parse('u.pas', [
    '{ [impl:p/a#1] }',
    '(* [impl:p/b#1] *)',
    '// [impl:p/c#1]',
  ]);
  assert.deepEqual(items.map((i) => i.id), ['impl:p/a#1', 'impl:p/b#1', 'impl:p/c#1']);
});

test('Pascal (* *) block comment spans multiple lines', () => {
  const { items } = parse('u.pas', [
    '(* [impl:p/a#1]',
    '   [>>utest:p/a#1] *)',
  ]);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].needs, ['utest:p/a#1']);
});

test('HCL honours #, // and /* */ comments', () => {
  const { items } = parse('main.tf', [
    '# [impl:tf/a#1]',
    '// [impl:tf/b#1]',
    '/* [impl:tf/c#1] */',
  ]);
  assert.deepEqual(items.map((i) => i.id), ['impl:tf/a#1', 'impl:tf/b#1', 'impl:tf/c#1']);
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

test('Vue template does not treat // as a comment', () => {
  const { items } = parse('Link.vue', [
    '<template>',
    '  <a href="https://example.com/[impl:not-a-tag#1]">x</a>',
    '</template>',
  ]);
  assert.equal(items.length, 0);
});

test('Vue <script> uses JS comments, <style> uses CSS comments', () => {
  const { items } = parse('Button.vue', [
    '<template><button>ok</button></template>',
    '<script setup lang="ts">',
    '// [impl:ui/button#1]',
    '// [>>utest:ui/button#1]',
    '</script>',
    '<style scoped>',
    '/* [impl:ui/button-style#1] */',
    '</style>',
  ]);
  assert.equal(items.length, 2);
  assert.equal(items[0].id, 'impl:ui/button#1');
  assert.deepEqual(items[0].needs, ['utest:ui/button#1']);
  assert.equal(items[1].id, 'impl:ui/button-style#1');
});

test('Vue <style> does not treat // as a comment', () => {
  const { items } = parse('Button.vue', [
    '<style>',
    '.x { background: url(//cdn/[impl:not-a-tag#1].png); }',
    '</style>',
  ]);
  assert.equal(items.length, 0);
});

test('an HTML comment containing <script> does not open a script region', () => {
  const { items } = parse('page.html', [
    '<!-- <script> [impl:page/head#1] -->',
    '<p>// [impl:not-a-tag#1]</p>',
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'impl:page/head#1');
});

test('plain .html files scan markup, script and style regions', () => {
  const { items } = parse('index.html', [
    '<!-- [impl:web/page#1] -->',
    '<script>// [impl:web/script#1]</script>',
    '<style>/* [impl:web/style#1] */</style>',
  ]);
  assert.deepEqual(
    items.map((i) => i.id),
    ['impl:web/page#1', 'impl:web/script#1', 'impl:web/style#1'],
  );
});
