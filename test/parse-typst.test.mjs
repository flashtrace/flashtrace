import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTypst } from '../src/main.mjs';

// Fixtures are built from line arrays: backticked IDs inside template
// literals would need escaping and hurt readability.
function parse(lines) {
  const problems = [];
  const forwards = [];
  const items = parseTypst('spec.typ', lines.join('\n'), problems, forwards);
  return { items, problems, forwards };
}

test('full item: title, description, needs, covers, tags', () => {
  const { items, problems } = parse([
    '== Login requires a valid session token',
    '`req:auth/login#1`',
    '',
    'The system only accepts requests that carry a valid session token.',
    'A second line still belongs to the description.',
    '',
    'Everything after the blank line above is informative and ignored.',
    '',
    'Needs: `impl:auth/login#1`, `utest:auth/login#1`',
    '',
    'Covers:',
    '- `feat:auth#1`',
    '',
    'Tags: Auth, Security',
  ]);

  assert.equal(problems.length, 0);
  assert.equal(items.length, 1);
  const item = items[0];
  assert.equal(item.id, 'req:auth/login#1');
  assert.equal(item.key, 'req:auth/login');
  assert.equal(item.revision, '1');
  assert.equal(item.origin, 'spec');
  assert.equal(item.file, 'spec.typ');
  assert.equal(item.line, 2);
  assert.equal(item.title, 'Login requires a valid session token');
  assert.deepEqual(item.description, [
    'The system only accepts requests that carry a valid session token.',
    'A second line still belongs to the description.',
  ]);
  assert.deepEqual(item.needs, ['impl:auth/login#1', 'utest:auth/login#1']);
  assert.deepEqual(item.covers, ['feat:auth#1']);
  assert.deepEqual(item.tags, ['Auth', 'Security']);
});

test('title survives blank lines between heading and ID', () => {
  const { items } = parse(['= The title', '', '', '`req:a#1`']);
  assert.equal(items[0].title, 'The title');
});

test('non-blank text between heading and ID means no title', () => {
  const { items } = parse(['= The title', 'some other text', '`req:a#1`']);
  assert.equal(items[0].title, null);
});

// Typst headings carry any number of `=`; every depth titles the item.
for (const marker of ['=', '==', '=====']) {
  test(`a "${marker}" heading is recognized as the title`, () => {
    const { items } = parse([`${marker} The title`, '`req:a#1`']);
    assert.equal(items[0].title, 'The title');
  });
}

test('a trailing <label> on the heading is metadata, not title text', () => {
  const { items } = parse(['= Authentication <auth-chapter>', '`req:a#1`']);
  assert.equal(items[0].title, 'Authentication');
});

test('a heading carrying only a label yields no title', () => {
  const { items } = parse(['= <auth-chapter>', '`req:a#1`']);
  assert.equal(items[0].title, null);
});

// A `=` run without text is no Typst heading, and Markdown's setext form (a
// paragraph above a `===` underline) has no Typst equivalent: neither titles.
test('a setext-style underline is not a heading', () => {
  const { items } = parse(['The title', '=========', '', '`req:a#1`']);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, null);
});

test('an item definition ends at the next ID line or heading', () => {
  const { items } = parse([
    '`req:a#1`',
    'Needs: `impl:a#1`',
    '`req:b#1`',
    '',
    '= Later heading',
    'Needs: `impl:stray#1`',
  ]);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0].needs, ['impl:a#1']);
  assert.deepEqual(items[1].needs, []);
});

// Typst list markers: `-` (bullet list) and `+` (enumeration). `*` spells
// strong emphasis in Typst and must not collect an entry.
for (const marker of ['-', '+']) {
  test(`needs as "${marker}" list, IDs backticked or #-free`, () => {
    const { items, problems } = parse([
      '`req:a#1`',
      '',
      'Needs:',
      `${marker} \`impl:a#1\``,
      `${marker} \`utest:a#1\``,
    ]);
    assert.equal(problems.length, 0);
    assert.deepEqual(items[0].needs, ['impl:a#1', 'utest:a#1']);
  });
}

test('a "*" line is emphasis, not a list entry', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '',
    'Needs:',
    '- `impl:a#1`',
    '* not an entry',
  ]);
  assert.equal(problems.length, 0);
  assert.deepEqual(items[0].needs, ['impl:a#1']);
});

test('inline comma-separated needs and covers', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '',
    'Needs: `impl:a#1`, `utest:a#1`',
    '',
    'Covers: `feat:a#1`, `feat:b#1`',
  ]);
  assert.equal(problems.length, 0);
  assert.deepEqual(items[0].needs, ['impl:a#1', 'utest:a#1']);
  assert.deepEqual(items[0].covers, ['feat:a#1', 'feat:b#1']);
});

// The Typst term list `/ Needs: ...` is the idiomatic spelling of a labeled
// field and works exactly like the bare keyword line.
test('a term list item spells a keyword line', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '',
    '/ Needs: `impl:a#1`',
    '/ Covers: `feat:a#1`',
    '/ Tags: Auth',
  ]);
  assert.equal(problems.length, 0);
  assert.deepEqual(items[0].needs, ['impl:a#1']);
  assert.deepEqual(items[0].covers, ['feat:a#1']);
  assert.deepEqual(items[0].tags, ['Auth']);
});

test('a term list keyword collects a list on the following lines', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '',
    '/ Needs:',
    '- `impl:a#1`',
    '+ `utest:a#1`',
  ]);
  assert.equal(problems.length, 0);
  assert.deepEqual(items[0].needs, ['impl:a#1', 'utest:a#1']);
});

// A bare entry carrying a revision would not survive Typst compilation: the
// `#` opens code mode and the rendered document drops it. It is reported at
// the entry, not silently accepted - and not passed on as a need.
test('a bare needs entry with a revision is reported, backticked accepted', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '',
    'Needs: impl:a#1, `utest:a#1`',
  ]);
  assert.deepEqual(items[0].needs, ['utest:a#1']);
  assert.equal(problems.length, 1);
  assert.match(
    problems[0].message,
    /bare ID "impl:a#1" in Needs: list of req:a#1; a '#' outside backticks opens Typst code mode - wrap the ID in backticks/,
  );
  assert.equal(problems[0].line, 3);
  assert.equal(problems[0].character, 8); // the 'i' of impl:a#1
});

test('a bare covers entry with a revision is reported alike', () => {
  const { items, problems } = parse(['`req:a#1`', '', 'Covers: feat:a#1']);
  assert.deepEqual(items[0].covers, []);
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /bare ID "feat:a#1" in Covers: list of req:a#1/);
});

// `#`-free short forms render verbatim in Typst, so they stay accepted bare
// and complete from the stating item like everywhere else.
test('bare #-free short forms are accepted and completed', () => {
  const { items, problems } = parse([
    '`req:auth/login#3`',
    '',
    'Needs: impl, impl:other, dsn:auth/audit',
  ]);
  assert.equal(problems.length, 0);
  assert.deepEqual(items[0].needs, ['impl:auth/login#3', 'impl:other#3', 'dsn:auth/audit#3']);
});

test('a backticked short form takes the [group/]name from the item', () => {
  const { items, problems } = parse([
    '`req:auth/login#1`',
    '',
    'Needs: `impl#2`, `utest#2.x`',
  ]);
  assert.equal(problems.length, 0);
  assert.deepEqual(items[0].needs, ['impl:auth/login#2', 'utest:auth/login#2.x']);
});

test('a wildcard revision is accepted in Needs but not in Covers', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '',
    'Needs: `impl:a#2.x`, `impl:b#2.3.x`, `impl:c#2.*`, `impl:d#x`',
    '',
    'Covers: `feat:x#1.x`',
  ]);
  assert.deepEqual(items[0].needs, ['impl:a#2.x', 'impl:b#2.3.x', 'impl:c#2.*', 'impl:d#x']);
  assert.deepEqual(items[0].covers, []);
  assert.equal(problems.length, 1);
  // the entry is quoted as written, backticks included
  assert.match(problems[0].message, /invalid ID "`feat:x#1\.x`" in Covers/);
});

test('invalid ID in a Needs list is reported as a problem', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '',
    'Needs: not/valid, `impl:ok#1`',
  ]);
  assert.deepEqual(items[0].needs, ['impl:ok#1']);
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /invalid ID "not\/valid"/);
  assert.equal(problems[0].file, 'spec.typ');
});

test('a wildcard revision is not accepted in an item definition', () => {
  const { items } = parse(['`req:a#2.x`', '`req:b#*`']);
  assert.equal(items.length, 0);
});

test('revisions may carry up to three semver-style layers', () => {
  const { items, problems } = parse(['`req:a#1`', '', '`req:b#2.4`', '', '`req:c#2.4.0`']);
  assert.equal(problems.length, 0);
  assert.deepEqual(
    items.map((item) => item.id),
    ['req:a#1', 'req:b#2.4', 'req:c#2.4.0'],
  );
});

test('group paths may be nested arbitrarily deep', () => {
  const { items } = parse(['`req:auth/session/login#1`']);
  assert.equal(items[0].id, 'req:auth/session/login#1');
  assert.equal(items[0].key, 'req:auth/session/login');
});

test('a line that is not only an ID does not define an item', () => {
  const { items } = parse(['The ID `req:a#1` mentioned in prose is not a definition.']);
  assert.equal(items.length, 0);
});

// Typst comments are live markup-mode syntax: what they swallow is not part
// of the rendered document and must not be part of the trace either.

test('a line comment hides an ID line and a keyword line', () => {
  const { items } = parse([
    '// `req:hidden#1`',
    '`req:a#1`',
    '// Needs: `impl:hidden#1`',
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'req:a#1');
  assert.deepEqual(items[0].needs, []);
});

test('a trailing line comment does not break a definition or a keyword line', () => {
  const { items, problems } = parse([
    '`req:a#1` // reviewed',
    '',
    'Needs: `impl:a#1` // the parser side',
  ]);
  assert.equal(problems.length, 0);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].needs, ['impl:a#1']);
});

test('a block comment hides every line it spans', () => {
  const { items } = parse([
    '/*',
    '`req:hidden#1`',
    '',
    'Needs: `impl:hidden#1`',
    '*/',
    '`req:a#1`',
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'req:a#1');
});

test('block comments nest, as in Typst', () => {
  const { items } = parse([
    '/* outer /* inner */',
    '`req:hidden#1`',
    '*/',
    '`req:a#1`',
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'req:a#1');
});

test('a comment-only line between heading and ID still permits the title', () => {
  const { items } = parse(['= The title', '// a note', '`req:a#1`']);
  assert.equal(items[0].title, 'The title');
});

test('comment markers inside a raw span stay literal', () => {
  const { items } = parse(['`req:a#1`', 'The description mentions `//` markers.']);
  assert.deepEqual(items[0].description, ['The description mentions `//` markers.']);
});

test('the // of a URL is link text, not a comment', () => {
  const { items } = parse([
    '`req:a#1`',
    'See https://example.com/docs for details.',
  ]);
  assert.deepEqual(items[0].description, ['See https://example.com/docs for details.']);
});

test('a raw block displays IDs and keywords without tracing them', () => {
  const { items } = parse([
    '`req:a#1`',
    '',
    '```typst',
    '`req:example#1`',
    'Needs: `impl:example#1`',
    '```',
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'req:a#1');
  assert.deepEqual(items[0].needs, []);
});

// Forwarding: only the backticked spelling survives Typst compilation (bare,
// the brackets are content-block delimiters and `--` ligates to an en dash).

test('a backticked forwarding line is recognized, spaces optional', () => {
  const { items, forwards } = parse([
    '`[req:login#1 --> dsn:auth#2]`',
    '',
    '`[req:logout#1-->dsn:auth#2]`',
  ]);
  assert.equal(items.length, 0);
  assert.deepEqual(forwards, [
    { from: 'req:login#1', to: 'dsn:auth#2', file: 'spec.typ', line: 1, character: 1 },
    { from: 'req:logout#1', to: 'dsn:auth#2', file: 'spec.typ', line: 3, character: 1 },
  ]);
});

test('a bare forwarding line is reported, not recognized', () => {
  const { forwards, problems } = parse(['[req:a#1 --> dsn:b#1]']);
  assert.equal(forwards.length, 0);
  assert.equal(problems.length, 1);
  assert.match(
    problems[0].message,
    /bare forwarding tag \[req:a#1 --> dsn:b#1\]; a '#' outside backticks opens Typst code mode - wrap the tag in backticks/,
  );
  assert.equal(problems[0].line, 1);
  assert.equal(problems[0].character, 1);
});

test('a forwarding line inside an item body is not description', () => {
  const { items, forwards } = parse([
    '`req:a#1`',
    '',
    'The description.',
    '`[req:a#1 --> dsn:b#1]`',
    'Still the description.',
  ]);
  assert.deepEqual(items[0].description, ['The description.', 'Still the description.']);
  assert.equal(forwards.length, 1);
  assert.deepEqual(forwards[0], { from: 'req:a#1', to: 'dsn:b#1', file: 'spec.typ', line: 4, character: 1 });
});

test('a forwarding mentioned in prose is not recognized', () => {
  const { forwards, problems } = parse(['The tag `[req:a#1 --> dsn:b#1]` in prose does not forward.']);
  assert.equal(forwards.length, 0);
  assert.equal(problems.length, 0);
});

// Keyword entries from #table(...) calls - the Typst equivalent of a
// Markdown keyword table column.

test('needs from a table column among irrelevant columns', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '',
    '#table(',
    '  columns: 3,',
    '  [Feature], [Needs], [Owner],',
    '  [Login], [`impl:a#1`], [Alice],',
    '  [Logout], [`utest:a#1`], [Bob],',
    ')',
  ]);
  assert.equal(problems.length, 0);
  assert.deepEqual(items[0].needs, ['impl:a#1', 'utest:a#1']);
});

test('table.header cells name the keyword columns', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '',
    '#table(',
    '  columns: 2,',
    '  table.header([Feature], [Needs]),',
    '  [Login], [`impl:a#1`],',
    ')',
  ]);
  assert.equal(problems.length, 0);
  assert.deepEqual(items[0].needs, ['impl:a#1']);
});

test('a parenthesized track list counts the columns', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '',
    '#table(',
    '  columns: (auto, 1fr),',
    '  [Feature], [Needs],',
    '  [Login], [`impl:a#1`],',
    ')',
  ]);
  assert.equal(problems.length, 0);
  assert.deepEqual(items[0].needs, ['impl:a#1']);
});

test('without a columns argument the table.header cell count rules', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '',
    '#table(',
    '  table.header([Needs], [Covers]),',
    '  [`impl:a#1`], [`feat:a#1`],',
    ')',
  ]);
  assert.equal(problems.length, 0);
  assert.deepEqual(items[0].needs, ['impl:a#1']);
  assert.deepEqual(items[0].covers, ['feat:a#1']);
});

test('one table may feed Needs, Covers, and Tags columns at once', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '',
    '#table(',
    '  columns: 3,',
    '  [Needs], [Covers], [Tags],',
    '  [`impl:a#1`], [`feat:a#1`], [Auth],',
    '  [`utest:a#1`], [], [Security],',
    ')',
  ]);
  assert.equal(problems.length, 0);
  assert.deepEqual(items[0].needs, ['impl:a#1', 'utest:a#1']);
  assert.deepEqual(items[0].covers, ['feat:a#1']);
  assert.deepEqual(items[0].tags, ['Auth', 'Security']);
});

test('named arguments and line decorations are skipped, not read as cells', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '',
    '#table(',
    '  columns: 2,',
    '  fill: (x, y) => if y == 0 { gray },',
    '  align: center,',
    '  table.hline(stroke: 2pt),',
    '  [Feature], [Needs],',
    '  [Login], [`impl:a#1`],',
    ')',
  ]);
  assert.equal(problems.length, 0);
  assert.deepEqual(items[0].needs, ['impl:a#1']);
});

test('empty and missing keyword cells are skipped', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '',
    '#table(',
    '  columns: 2,',
    '  [Feature], [Needs],',
    '  [Login], [`impl:a#1`],',
    '  [Empty cell], [],',
    '  [Row too short],',
    ')',
  ]);
  assert.equal(problems.length, 0);
  assert.deepEqual(items[0].needs, ['impl:a#1']);
});

test('invalid ID in a table cell is reported with the cell position', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '',
    '#table(',
    '  columns: 1,',
    '  [Needs],',
    '  [`impl:ok#1`],',
    '  [not/valid],',
    ')',
  ]);
  assert.deepEqual(items[0].needs, ['impl:ok#1']);
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /invalid ID "not\/valid" in the Needs column of req:a#1/);
  assert.equal(problems[0].line, 7);
  assert.equal(problems[0].character, 4);
});

test('a bare revision-carrying cell is reported like an inline entry', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '',
    '#table(',
    '  columns: 1,',
    '  [Needs],',
    '  [impl:a#1],',
    ')',
  ]);
  assert.deepEqual(items[0].needs, []);
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /bare ID "impl:a#1" in the Needs column of req:a#1/);
});

test('a wildcard revision is accepted in a Needs column but not in a Covers column', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '',
    '#table(',
    '  columns: 2,',
    '  [Needs], [Covers],',
    '  [`impl:a#2.x`], [`feat:x#1.x`],',
    ')',
  ]);
  assert.deepEqual(items[0].needs, ['impl:a#2.x']);
  assert.deepEqual(items[0].covers, []);
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /invalid ID "`feat:x#1\.x`" in the Covers column of req:a#1/);
});

test('a table without a keyword header stays informative', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '',
    '#table(',
    '  columns: 2,',
    '  [Feature], [Owner],',
    '  [Login], [Alice],',
    ')',
  ]);
  assert.equal(problems.length, 0);
  assert.deepEqual(items[0].needs, []);
});

test('an item defined inside a table cell is flagged and creates no item', () => {
  const { items, problems } = parse([
    '#table(',
    '  columns: 2,',
    '  [ID], [Owner],',
    '  [`req:x#1`], [Alice],',
    ')',
  ]);
  assert.equal(items.length, 0);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].line, 4);
  assert.equal(problems[0].character, 4);
  assert.match(problems[0].message, /item req:x#1 defined inside a table; a table cell is not an item definition/);
});

test('a backticked ID in a keyword column is an entry, not a flagged definition', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '',
    '#table(',
    '  columns: 1,',
    '  [Needs],',
    '  [`impl:a#1`],',
    ')',
  ]);
  assert.equal(problems.length, 0);
  assert.deepEqual(items[0].needs, ['impl:a#1']);
});

test('a definition-shaped cell outside the keyword columns is flagged', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '',
    '#table(',
    '  columns: 2,',
    '  [Feature], [Needs],',
    '  [`req:x#1`], [`impl:a#1`],',
    ')',
  ]);
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /item req:x#1 defined inside a table/);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].needs, ['impl:a#1']);
});

test('a table.cell call makes the table unreadable; its keyword column is reported', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '',
    '#table(',
    '  columns: 2,',
    '  [Feature], [Needs],',
    '  table.cell(colspan: 2)[Spanning],',
    '  [Login], [`impl:a#1`],',
    ')',
  ]);
  assert.deepEqual(items[0].needs, []);
  assert.equal(problems.length, 1);
  assert.match(
    problems[0].message,
    /a Needs column in a table the tracer cannot read \(a table\.cell or unrecognized call makes the columns ambiguous\); the table contributes no entries/,
  );
  assert.equal(problems[0].line, 3);
  assert.equal(problems[0].character, 1);
});

test('a keyword table terminates the description like a keyword line', () => {
  const { items } = parse([
    '`req:a#1`',
    '',
    'The description.',
    '#table(',
    '  columns: 1,',
    '  [Needs],',
    '  [`impl:a#1`],',
    ')',
    'Not description anymore.',
  ]);
  assert.deepEqual(items[0].description, ['The description.']);
  assert.deepEqual(items[0].needs, ['impl:a#1']);
});

test('an informative table is display material, not description', () => {
  const { items } = parse([
    '`req:a#1`',
    'The description.',
    '#table(',
    '  columns: 1,',
    '  [Feature],',
    '  [Login],',
    ')',
    'Still the description.',
  ]);
  assert.deepEqual(items[0].description, ['The description.', 'Still the description.']);
});

test('a heading-shaped line inside a multi-line cell bounds and titles nothing', () => {
  const { items } = parse([
    '`req:a#1`',
    '',
    'Needs: `impl:a#1`',
    '',
    '#table(',
    '  columns: 1,',
    '  [Feature],',
    '  [',
    '    = Not a heading',
    '  ],',
    ')',
    '`req:b#1`',
  ]);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0].needs, ['impl:a#1']);
  assert.equal(items[1].title, null);
});

test('a table outside every item feeds nothing, its ID cells still flagged', () => {
  const { items, problems } = parse([
    '#table(',
    '  columns: 1,',
    '  [Needs],',
    '  [`impl:a#1`],',
    '  [`req:x#1`],',
    ')',
    '',
    '`req:a#1`',
  ]);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].needs, []);
  // both cells sit in the Needs column, so neither is a definition attempt
  assert.equal(problems.length, 0);
});

test('an unknown column count with keyword cells is reported, without them silent', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '',
    '#table(',
    '  columns: tracks,',
    '  [Needs],',
    '  [`impl:a#1`],',
    ')',
    '',
    '#table(',
    '  columns: tracks,',
    '  [Feature],',
    '  [Login],',
    ')',
  ]);
  assert.deepEqual(items[0].needs, []);
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /a Needs column in a table the tracer cannot read \(the column count is unknown\)/);
});

// Source columns: every location records the 1-based column of the construct
// it points at - the backtick of an ID line, the opener of a forwarding line,
// or the offending entry of a problem.

test('an item and a forwarding record the column of their construct', () => {
  const { items, forwards } = parse([
    '  `req:a#1`',
    '',
    '   `[req:a#1 --> dsn:b#1]`',
  ]);
  assert.equal(items[0].line, 1);
  assert.equal(items[0].character, 3); // the backtick, past two spaces
  assert.deepEqual(forwards, [
    { from: 'req:a#1', to: 'dsn:b#1', file: 'spec.typ', line: 3, character: 4 },
  ]);
});

test('an invalid inline Needs entry is reported at the entry column', () => {
  const { problems } = parse([
    '`req:a#1`',
    '',
    'Needs: `impl:ok#1`, not/valid',
  ]);
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /invalid ID "not\/valid"/);
  assert.equal(problems[0].line, 3);
  assert.equal(problems[0].character, 21); // the 'n' of not/valid
});

test('an invalid list Needs entry is reported at its own line and column', () => {
  const { problems } = parse([
    '`req:a#1`',
    '',
    'Needs:',
    '  - not/valid',
  ]);
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /invalid ID "not\/valid"/);
  assert.equal(problems[0].line, 4); // the list line, not the keyword line
  assert.equal(problems[0].character, 5); // the 'n', past "  - "
});
