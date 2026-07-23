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
    '// [>>utest:c#*]',
    '// [impl:a#1 >> utest:d#x]',
  ]);
  assert.equal(problems.length, 0);
  assert.deepEqual(items[0].needs, ['utest:a#2.x', 'utest:b#2.3.x', 'utest:c#*', 'utest:d#x']);
});

test('an explicit need tag may spell its anchor with a SemVer-equal revision', () => {
  const { items, problems } = parse('src.ts', [
    '// [impl:a#1]',
    '// [impl:a#1.0.0 >> utest:a#2]',
  ]);
  assert.equal(problems.length, 0);
  assert.deepEqual(items[0].needs, ['utest:a#2']);
});

test('a wildcard revision is not accepted in an item tag', () => {
  const { items } = parse('src.ts', ['// [impl:a#2.x]']);
  assert.equal(items.length, 0);
});

test('a short-form need target takes name and revision from the anchor item', () => {
  const { items, problems } = parse('src.ts', [
    '// [impl:auth/login#2]',
    '// [>>utest]',
    '// [>>utest#3]',
    '// [>>dsn:auth/audit]',
  ]);
  assert.equal(problems.length, 0);
  // utest -> both taken; utest#3 -> name taken; dsn:auth/audit -> revision taken
  assert.deepEqual(items[0].needs, [
    'utest:auth/login#2',
    'utest:auth/login#3',
    'dsn:auth/audit#2',
  ]);
});

test('an explicit short-form need target is completed from the named source item', () => {
  const { items, problems } = parse('src.ts', [
    '// [impl:a#1]',
    '// [impl:b#1]',
    '// [impl:a#1 >> utest#2.x]',
    '// [impl:b#1 >> utest]',
  ]);
  assert.equal(problems.length, 0);
  assert.deepEqual(items[0].needs, ['utest:a#2.x']);
  assert.deepEqual(items[1].needs, ['utest:b#1']);
});

test('a short-form need tag without a preceding item tag is a problem', () => {
  const { items, problems } = parse('src.ts', ['// [>>utest]']);
  assert.equal(items.length, 0);
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /\[>>utest\] has no preceding item tag/);
});

test('a short-form reference is not accepted in an item tag', () => {
  const { items, problems } = parse('src.ts', ['// [impl#1]', '// [impl]']);
  assert.equal(items.length, 0);
  assert.equal(problems.length, 0);
});

test('tags outside comments are ignored', () => {
  const { items } = parse('src.ts', ['const s = "[impl:a#1]";']);
  assert.equal(items.length, 0);
});

test('a // inside a URL does not open a comment, a later real // does', () => {
  const { items } = parse('src.ts', [
    'const docs = "https://example.com/specs"; // [impl:real#1]',
    'const api = "https://example.com/api"; register("[impl:phantom#1]");',
  ]);
  assert.deepEqual(items.map((i) => i.id), ['impl:real#1']);
});

test('a # fragment in a URL does not open a comment (Python)', () => {
  const { items } = parse('app.py', [
    'link = "https://example.com/docs#setup [impl:phantom#1]"  # [impl:real#1]',
  ]);
  assert.deepEqual(items.map((i) => i.id), ['impl:real#1']);
});

test('a -- in a URL path does not open a comment (SQL)', () => {
  const { items } = parse('schema.sql', [
    "INSERT INTO links VALUES ('https://example.com/a--b'); -- [impl:real#1]",
  ]);
  assert.deepEqual(items.map((i) => i.id), ['impl:real#1']);
});

test('a /* inside a URL does not open a block comment', () => {
  const { items } = parse('src.ts', [
    'const glob = "https://example.com/*/index";',
    'const s = "[impl:phantom#1]";',
  ]);
  assert.equal(items.length, 0);
});

test('a URL in an embedded <script> string does not define a phantom item', () => {
  const { items } = parse('page.html', [
    '<script>',
    'const u = "https://cdn.example.com/lib.js"; run("[impl:phantom#1]");',
    '</script>',
  ]);
  assert.equal(items.length, 0);
});

test('a URL inside a comment does not hide a tag after it', () => {
  const { items } = parse('src.ts', [
    '// see https://example.com/spec [impl:real#1]',
  ]);
  assert.deepEqual(items.map((i) => i.id), ['impl:real#1']);
});

test('a comment opener glued to a scheme-shaped token is missed (known limitation)', () => {
  const { items } = parse('src.ts', ['const x = 1; note://[impl:missed#1]']);
  assert.equal(items.length, 0);
});

test('a */ inside a URL still closes an open block comment', () => {
  // Block *closers* are honoured inside URLs (unlike openers): the `*/` in the
  // URL ends the block, so the following line is scanned as code, not comment.
  const { items } = parse('src.ts', [
    '/* see https://example.com/a*/b',
    'const s = "[impl:phantom#1]";',
  ]);
  assert.equal(items.length, 0);
});

test('markers in multiple URLs on one line are all skipped, a trailing real comment opens', () => {
  const { items } = parse('src.ts', [
    'const a = "https://x.example/p"; const b = "https://y.example/q"; // [impl:real#1]',
  ]);
  assert.deepEqual(items.map((i) => i.id), ['impl:real#1']);
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

test('C-like extras (Groovy, Solidity, .cxx) use // and /* */', () => {
  for (const file of ['build.gradle', 'app.groovy', 'Token.sol', 'engine.cxx']) {
    const { items, problems } = parse(file, [
      '// [impl:x/run#1]',
      '/* [>>utest:x/run#1] */',
    ]);
    assert.equal(problems.length, 0, file);
    assert.equal(items.length, 1, file);
    assert.deepEqual(items[0].needs, ['utest:x/run#1'], file);
  }
});

test('PHP accepts // and # line comments and /* */', () => {
  const { items } = parse('index.php', [
    '// [impl:php/a#1]',
    '# [impl:php/b#1]',
    '/* [impl:php/c#1] */',
  ]);
  assert.deepEqual(items.map((i) => i.id), ['impl:php/a#1', 'impl:php/b#1', 'impl:php/c#1']);
});

test('hash-comment extras (Crystal, GDScript, awk) recognise # tags', () => {
  for (const file of ['app.cr', 'player.gd', 'report.awk']) {
    const { items, problems } = parse(file, [
      '# [impl:app/main#1]',
      'x = "// [impl:not-a-tag#1]"',
    ]);
    assert.equal(problems.length, 0, file);
    assert.deepEqual(items.map((i) => i.id), ['impl:app/main#1'], file);
  }
});

test('CMake uses # line and #[[ ]] block comments', () => {
  const { items } = parse('build.cmake', [
    '# [impl:cmake/mod#1]',
    '#[[ [>>utest:cmake/mod#1] ]]',
  ]);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].needs, ['utest:cmake/mod#1']);
});

test('CMake #[[ ]] block comment opens and spans multiple lines', () => {
  // #[[ shares its prefix with the # line marker; the block opener must win the
  // tie, otherwise the block never opens and the inner tags are missed.
  const { items } = parse('build.cmake', [
    '#[[',
    '  [impl:cmake/block#1]',
    '  [>>utest:cmake/block#1]',
    ']]',
    'add_executable(app main.c)',
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'impl:cmake/block#1');
  assert.deepEqual(items[0].needs, ['utest:cmake/block#1']);
});

test('Lua uses -- line and --[[ ]] block comments', () => {
  const { items } = parse('mod.lua', [
    '-- [impl:lua/mod#1]',
    '--[[ [>>utest:lua/mod#1] ]]',
  ]);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].needs, ['utest:lua/mod#1']);
});

test('Lua --[[ ]] block comment opens and spans multiple lines', () => {
  // --[[ shares its prefix with the -- line marker; the block opener must win
  // the tie, otherwise the block never opens and the inner tags are missed.
  const { items } = parse('mod.lua', [
    '--[[',
    '  [impl:lua/block#1]',
    '  [>>utest:lua/block#1]',
    ']]',
    'print("done")',
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'impl:lua/block#1');
  assert.deepEqual(items[0].needs, ['utest:lua/block#1']);
});

test('CoffeeScript uses # line and ### ### block comments', () => {
  const { items } = parse('app.coffee', [
    '# [impl:cs/app#1]',
    '### [>>utest:cs/app#1] ###',
  ]);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].needs, ['utest:cs/app#1']);
});

test('CoffeeScript ### block comment opens and spans multiple lines', () => {
  // ### shares its prefix with the # line marker; the block opener must win
  // the tie, otherwise the block never opens and the inner tags are missed.
  const { items } = parse('app.coffee', [
    '###',
    '  [impl:cs/block#1]',
    '  [>>utest:cs/block#1]',
    '###',
    'run()',
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'impl:cs/block#1');
  assert.deepEqual(items[0].needs, ['utest:cs/block#1']);
});

test('CoffeeScript #### heading is a line comment, not a block opener', () => {
  // The language opens a block on ### only when no further # follows, so this
  // heading must not open one and leave the code below scanned as comment text.
  const { items } = parse('app.coffee', [
    '#### Section',
    '[impl:cs/heading#1]',
    'run()',
  ]);
  assert.equal(items.length, 0);
});

test('CoffeeScript ########## divider is a line comment, not a block opener', () => {
  const { items } = parse('app.coffee', [
    '# [impl:cs/divider#1]',
    '##########',
    '### [>>utest:cs/divider#1] ###',
  ]);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].needs, ['utest:cs/divider#1']);
});

test('Julia uses # line and #= =# block comments, which nest', () => {
  const { items } = parse('mod.jl', [
    '# [impl:jl/mod#1]',
    '#= outer #= inner =# [>>utest:jl/mod#1] =#',
  ]);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].needs, ['utest:jl/mod#1']);
});

test('Julia #= =# block comment opens and spans multiple lines', () => {
  // #= shares its prefix with the # line marker; the block opener must win
  // the tie for the block to open.
  const { items } = parse('mod.jl', [
    '#=',
    '  [impl:jl/block#1]',
    '  [>>utest:jl/block#1]',
    '=#',
    'x = 1',
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'impl:jl/block#1');
  assert.deepEqual(items[0].needs, ['utest:jl/block#1']);
});

test('Nim uses # line and #[ ]# block comments, which nest', () => {
  const { items } = parse('mod.nim', [
    '# [impl:nim/mod#1]',
    '#[ outer #[ inner ]# [>>utest:nim/mod#1] ]#',
  ]);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].needs, ['utest:nim/mod#1']);
});

test('Nim ##[ ]## doc block comments are recognized and nest', () => {
  const { items } = parse('mod.nim', [
    '# [impl:nim/doc#1]',
    '##[ outer ##[ inner ]## [>>utest:nim/doc#1] ]##',
  ]);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].needs, ['utest:nim/doc#1']);
});

test('Nim ##[ ]## doc block opens and spans multiple lines', () => {
  // ##[ shares a prefix with both the # line marker and the #[ opener; the
  // longest match at the tie must win for the doc block to open as one.
  const { items } = parse('mod.nim', [
    '##[',
    '  [impl:nim/docblock#1]',
    '  [>>utest:nim/docblock#1]',
    ']##',
    'x = 1',
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'impl:nim/docblock#1');
  assert.deepEqual(items[0].needs, ['utest:nim/docblock#1']);
});

test('Scheme uses ; line and #| |# block comments, which nest', () => {
  const { items } = parse('lib.scm', [
    '; [impl:scm/lib#1]',
    '#| outer #| inner |# [>>utest:scm/lib#1] |#',
  ]);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].needs, ['utest:scm/lib#1']);
});

test('Scheme #| |# block comment opens and spans multiple lines', () => {
  const { items } = parse('lib.scm', [
    '#|',
    '  [impl:scm/block#1]',
    '  [>>utest:scm/block#1]',
    '|#',
    '(run)',
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'impl:scm/block#1');
  assert.deepEqual(items[0].needs, ['utest:scm/block#1']);
});

test('Racket (.rkt) shares the Scheme grammar', () => {
  const { items } = parse('lib.rkt', [
    '; [impl:rkt/lib#1]',
    '#| [>>utest:rkt/lib#1] |#',
  ]);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].needs, ['utest:rkt/lib#1']);
});

test('Guile/Chez (.ss) shares the Scheme grammar', () => {
  const { items } = parse('lib.ss', [
    '; [impl:ss/lib#1]',
    '#| [>>utest:ss/lib#1] |#',
  ]);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].needs, ['utest:ss/lib#1']);
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

test('OCaml (* *) block comments nest', () => {
  const { items } = parse('m.ml', [
    '(* outer (* inner *) [impl:ml/still#1] *)',
    'let x = 1',
  ]);
  assert.deepEqual(items.map((i) => i.id), ['impl:ml/still#1']);
});

test('Haskell {- -} block comments nest', () => {
  const { items } = parse('M.hs', [
    '{- outer {- inner -} [impl:hs/still#1] -}',
    'x = 1',
  ]);
  assert.deepEqual(items.map((i) => i.id), ['impl:hs/still#1']);
});

test('Elm and PureScript share the Haskell grammar (nesting {- -})', () => {
  for (const file of ['Main.elm', 'Main.purs']) {
    const { items, problems } = parse(file, [
      '-- [impl:m/main#1]',
      '{- outer {- inner -} [>>utest:m/main#1] -}',
    ]);
    assert.equal(problems.length, 0, file);
    assert.equal(items.length, 1, file);
    assert.deepEqual(items[0].needs, ['utest:m/main#1'], file);
  }
});

test('Pascal (* *) does not nest (closes at the first *))', () => {
  const { items } = parse('u.pas', [
    '(* outer (* inner *) [impl:p/code-not-tag#1] *)',
  ]);
  assert.equal(items.length, 0);
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
    { from: 'req:login#1', to: 'dsn:auth#2', file: 'src.ts', line: 1, character: 4 },
    { from: 'req:logout#1', to: 'dsn:auth#2', file: 'src.ts', line: 2, character: 4 },
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

test('a line comment before </script> does not swallow the region exit', () => {
  const { items } = parse('page.html', [
    '<script>// setup</script>',
    '<p>// [impl:phantom#1]</p>',
  ]);
  assert.equal(items.length, 0);
});

test('an unclosed block comment before </script> still ends the region', () => {
  const { items } = parse('page.html', [
    '<script>/* note </script>',
    '<p>// [impl:phantom#1]</p>',
  ]);
  assert.equal(items.length, 0);
});

test('a tag before </script> on the same line is still captured', () => {
  const { items } = parse('page.html', [
    '<script>// [impl:web/inline#1]</script>',
    '<p>plain markup</p>',
  ]);
  assert.deepEqual(items.map((i) => i.id), ['impl:web/inline#1']);
});

test('<script type="application/json"> is scanned without comments', () => {
  const { items } = parse('page.html', [
    '<script type="application/json">',
    '{ "url": "//cdn.example.com/[impl:phantom#1].js" }',
    '</script>',
  ]);
  assert.equal(items.length, 0);
});

test('<script type="text/x-template"> is scanned as HTML markup', () => {
  const { items } = parse('page.html', [
    '<script type="text/x-template">',
    '  <!-- [impl:ui/tpl#1] -->',
    '  <a href="//x/[impl:not-a-tag#1]">go</a>',
    '</script>',
  ]);
  assert.deepEqual(items.map((i) => i.id), ['impl:ui/tpl#1']);
});

test('<script lang="coffee"> uses # line and ### ### block comments', () => {
  const { items } = parse('page.html', [
    '<script lang="coffee">',
    '# [impl:web/coffee#1]',
    '###',
    '  [>>utest:web/coffee#1]',
    '###',
    '</script>',
  ]);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].needs, ['utest:web/coffee#1']);
});

test('<script lang="coffee"> treats #### as a line comment', () => {
  const { items } = parse('page.html', [
    '<script lang="coffee">',
    '#### Section',
    '[impl:web/heading#1]',
    '</script>',
  ]);
  assert.equal(items.length, 0);
});

test('<style lang="scss"> honours // line comments', () => {
  const { items } = parse('Button.vue', [
    '<style lang="scss">',
    '// [impl:ui/scss#1]',
    '.x { color: red; } /* [impl:ui/scss-block#1] */',
    '</style>',
  ]);
  assert.deepEqual(items.map((i) => i.id), ['impl:ui/scss#1', 'impl:ui/scss-block#1']);
});

test('a plain <style> still treats // as not-a-comment', () => {
  const { items } = parse('Button.vue', [
    '<style>',
    '.x { background: url(//cdn/[impl:not-a-tag#1].png); }',
    '</style>',
  ]);
  assert.equal(items.length, 0);
});

// Source columns: comment extraction is position-preserving, so a tag's column
// is the column of its opening bracket in the source line, whatever comment
// syntax and indentation precede it.

test('a code item tag records the column of its opening bracket', () => {
  const { items } = parse('src.ts', ['    // [impl:a#1]']);
  assert.equal(items[0].line, 1);
  assert.equal(items[0].character, 8); // the '[' past "    // "
});

test('a trailing line comment on real code records the tag column', () => {
  const { items, problems } = parse('src.ts', [
    'let variable = someFunctionReturningSomeValue(); // [impl:variable#1]',
  ]);
  assert.equal(problems.length, 0);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'impl:variable#1');
  assert.equal(items[0].origin, 'code');
  assert.equal(items[0].line, 1);
  assert.deepEqual(items[0].needs, []);
  assert.equal(items[0].character, 53); // the '[' past the code and "// "
});

test('a code item tag inside a block comment carries its bracket column', () => {
  const { items } = parse('src.ts', ['/* [impl:b#1] */']);
  assert.equal(items[0].character, 4); // the '[' past "/* "
});

test('an orphan need tag problem points at its bracket column', () => {
  const { problems } = parse('src.ts', ['  // [>>utest:a#1]']);
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /no preceding item tag/);
  assert.equal(problems[0].character, 6); // the '[' past "  // "
});

test('an unanchored explicit need tag problem points at its bracket column', () => {
  const { problems } = parse('src.ts', ['// [impl:x#1 >> utest:a#1]']);
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /no preceding item tag \[impl:x#1\]/);
  assert.equal(problems[0].character, 4); // the '[' past "// "
});
