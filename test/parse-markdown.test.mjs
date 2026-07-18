import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown } from '../src/main.mjs';

// Fixtures are built from line arrays: backticked IDs inside template
// literals would need escaping and hurt readability.
function parse(lines) {
  const problems = [];
  const forwards = [];
  const items = parseMarkdown('spec.md', lines.join('\n'), problems, forwards);
  return { items, problems, forwards };
}

test('full item: title, description, needs, covers, tags', () => {
  const { items, problems } = parse([
    '### Login requires a valid session token',
    '`req:auth/login#1`',
    '',
    'The system only accepts requests that carry a valid session token.',
    'A second line still belongs to the description.',
    '',
    'Everything after the blank line above is informative and ignored.',
    '',
    'Needs: impl:auth/login#1, utest:auth/login#1',
    '',
    'Covers:',
    '- feat:auth#1',
    '',
    'Tags: Auth, Security',
  ]);

  assert.equal(problems.length, 0);
  assert.equal(items.length, 1);
  const item = items[0];
  assert.equal(item.id, 'req:auth/login#1');
  assert.equal(item.key, 'req:auth/login');
  assert.equal(item.revision, '1');
  assert.equal(item.origin, 'markdown');
  assert.equal(item.file, 'spec.md');
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
  const { items } = parse(['# The title', '', '', '`req:a#1`']);
  assert.equal(items[0].title, 'The title');
});

test('non-blank text between heading and ID means no title', () => {
  const { items } = parse(['# The title', 'some other text', '`req:a#1`']);
  assert.equal(items[0].title, null);
});

// Setext-style headings: a paragraph line underlined with `=` (level 1) or
// `-` (level 2) is the item's title, just like an ATX `#` heading.
test('setext level-1 heading (===) is recognized as the title', () => {
  const { items } = parse(['Title level 1', '=============', '`req:a#1`']);
  assert.equal(items[0].title, 'Title level 1');
});

test('setext level-2 heading (---) is recognized as the title', () => {
  const { items } = parse(['Title level 2', '-------------', '`req:a#1`']);
  assert.equal(items[0].title, 'Title level 2');
});

test('a setext underline may carry trailing whitespace and up to three leading spaces', () => {
  const { items } = parse(['The title', '   ===   ', '`req:a#1`']);
  assert.equal(items[0].title, 'The title');
});

test('setext title survives blank lines between the underline and the ID', () => {
  const { items } = parse(['The title', '=========', '', '', '`req:a#1`']);
  assert.equal(items[0].title, 'The title');
});

// The underline must sit directly under a paragraph line. A thematic break is
// a run of `-` set off by a blank line, so it must not become a heading.
test('a thematic break (--- after a blank line) is not a setext heading', () => {
  const { items } = parse(['Some intro paragraph', '', '---', '', '`req:a#1`']);
  assert.equal(items[0].title, null);
});

// A table delimiter row carries pipes, so it is never a setext underline. The
// blank line ends the table; without it the ID line would be swallowed as a row.
test('a table delimiter row is not mistaken for a setext heading', () => {
  const { items } = parse(['| Feature | Owner |', '| --- | --- |', '', '`req:a#1`']);
  assert.equal(items[0].title, null);
});

// A run of `-` directly below a bullet ends the list; it is not a heading.
test('a bullet list above a run of dashes is not a setext heading', () => {
  const { items } = parse(['- item one', '- item two', '---', '`req:a#1`']);
  assert.equal(items[0].title, null);
});

// A setext heading claims only its own paragraph: the blank line above ends the
// description, which stays with the previous item while the heading titles the next.
test('a blank line separates the description from a following setext heading', () => {
  const { items } = parse([
    '`req:a#1`',
    'Description of a.',
    '',
    'Next Title',
    '==========',
    '`req:b#1`',
  ]);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0].description, ['Description of a.']);
  assert.equal(items[1].title, 'Next Title');
});

// The tracer folds every paragraph line down to the underline into one
// multi-line title: lines trimmed and joined with a space, or a newline where a
// line ends in two+ spaces (a hard break). Folded lines are never the description.
test('setext titles are multi-line and keep every folded line to themselves, not serving the item above as description', () => {
  const { items } = parse([
    '`req:a#1`',
    '',
    'First title line without trailing spaces.',
    'Second title line with actual line break by spaces.  ',
    'Third title line with space in the end. ',
    'Fourth title line with actual line break by spaces.  ',
    ' Fifth title line with space in the beginning.',
    '======================',
    '`req:b#1`',
  ]);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0].description, []);
  assert.equal(
    items[1].title,
    'First title line without trailing spaces. ' +
      'Second title line with actual line break by spaces.\n' +
      'Third title line with space in the end. ' +
      'Fourth title line with actual line break by spaces.\n' +
      'Fifth title line with space in the beginning.'
  );
});

// Glued onto the paragraph a setext underline turns into a heading, an ID line
// is heading text (CommonMark): reported, defining no item, and folded - with
// the rest of the run - into the following item's title.
test('an ID line glued above a setext heading is heading text, flagged and creating no item', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    'Some title',
    '==========',
    '`req:b#1`',
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'req:b#1');
  assert.equal(items[0].title, '`req:a#1` Some title');
  assert.equal(problems.length, 1);
  assert.equal(problems[0].line, 1);
  assert.match(problems[0].message, /item req:a#1 defined inside a setext heading; a heading is not an item definition/);
});

// The degenerate case: an ID line directly above an underline is itself the
// whole heading. It is reported and defines no item.
test('an ID line directly above a setext underline is the heading itself, flagged', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '==========',
    '`req:b#1`',
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'req:b#1');
  assert.equal(items[0].title, '`req:a#1`');
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /item req:a#1 defined inside a setext heading/);
});

// Every ID line folded into one heading is reported, not just the last: a run
// of two glued ID lines above an underline yields two problems and no items.
test('every ID line folded into a setext heading is flagged', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '`req:b#1`',
    '==========',
    '`req:c#1`',
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'req:c#1');
  assert.equal(problems.length, 2);
  assert.match(problems[0].message, /item req:a#1 defined inside a setext heading/);
  assert.match(problems[1].message, /item req:b#1 defined inside a setext heading/);
});

// A blank line below the ID keeps it a standalone definition: the paragraph
// that becomes the heading starts below the blank, so the ID stays an item.
test('a blank line below an ID keeps it a definition even when a setext heading follows', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '',
    'Some title',
    '==========',
    '`req:b#1`',
  ]);
  assert.equal(problems.length, 0);
  assert.equal(items.length, 2);
  assert.equal(items[0].id, 'req:a#1');
  assert.equal(items[1].title, 'Some title');
});

// A thematic break (a run of `-` set off by blank lines) is not a setext
// heading, so it must neither terminate the body nor split off a new item.
test('a thematic break inside a body does not terminate it or split the item', () => {
  const { items } = parse([
    '`req:a#1`',
    'Description of a.',
    '',
    '---',
    '',
    'More prose that is not a new item.',
  ]);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].description, ['Description of a.']);
});

// Underlined, a keyword line serves the setext title and is ignored for its
// keyword - exactly as `# Covers: ...` is a heading, not a keyword.
test('a keyword line above a setext underline serves the title, its keyword ignored', () => {
  const { items } = parse([
    '`req:a#1`',
    '',
    'Covers: req:x#1',
    '---',
    '`req:b#1`',
  ]);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0].covers, []);
  assert.equal(items[1].title, 'Covers: req:x#1');
});

// The same holds for a forwarding line - `# [a --> b]` would not forward either.
test('a forwarding line above a setext underline serves the title, its forward ignored', () => {
  const { items, forwards } = parse([
    '`req:a#1`',
    '',
    '[req:a#1 --> dsn:b#1]',
    '---',
    '`req:b#1`',
  ]);
  assert.equal(forwards.length, 0);
  assert.equal(items[1].title, '[req:a#1 --> dsn:b#1]');
});

// The fold covers the whole paragraph: a keyword line anywhere in the run
// that ends at an underline belongs to the title, not to the keyword list.
test('a keyword line folded into a multi-line setext title is ignored for its keyword', () => {
  const { items } = parse([
    '`req:a#1`',
    'Description of a.',
    '',
    'Covers: req:x#1  ',
    'Second title line',
    '=================',
    '`req:b#1`',
  ]);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0].covers, []);
  assert.deepEqual(items[0].description, ['Description of a.']);
  assert.equal(items[1].title, 'Covers: req:x#1\nSecond title line');
});

// A pipe alone does not make a line a table row: as in GFM, a pipe-carrying
// paragraph above an underline is a setext heading with the pipe in its text.
// Only membership in an actual table rules a line out.
test('a pipe-carrying paragraph above an underline is a setext title', () => {
  const { items, problems } = parse([
    'Login | Logout',
    '==============',
    '`req:a#1`',
  ]);
  assert.equal(problems.length, 0);
  assert.equal(items[0].title, 'Login | Logout');
});

// The same on the boundary side: the pipe-carrying paragraph opens a setext
// heading, so it terminates the body like any other heading.
test('a pipe-carrying line above an underline terminates the body and titles the next item', () => {
  const { items } = parse([
    '`req:a#1`',
    'Description of a.',
    '',
    'Login | Logout',
    '==============',
    '`req:b#1`',
  ]);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0].description, ['Description of a.']);
  assert.equal(items[1].title, 'Login | Logout');
});

// The same rule applies to ATX headings: the pipe is plain text and stays
// in the title.
test('an ATX heading may carry a pipe and still titles the item', () => {
  const { items } = parse(['## Login | Logout', '`req:a#1`']);
  assert.equal(items[0].title, 'Login | Logout');
});

test('needs as bullet list, IDs optionally backticked', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '',
    'Needs:',
    '- `impl:a#1`',
    '- utest:a#1',
  ]);
  assert.equal(problems.length, 0);
  assert.deepEqual(items[0].needs, ['impl:a#1', 'utest:a#1']);
});

// Every bullet marker (-, *, +) must be accepted, and each item ID may be
// written bare or wrapped in backticks - independently within one list.
for (const marker of ['-', '*', '+']) {
  test(`needs as "${marker}" bullet list, IDs bare or backticked`, () => {
    const { items, problems } = parse([
      '`req:a#1`',
      '',
      'Needs:',
      `${marker} \`impl:a#1\``,
      `${marker} utest:a#1`,
    ]);
    assert.equal(problems.length, 0);
    assert.deepEqual(items[0].needs, ['impl:a#1', 'utest:a#1']);
  });
}

test('inline comma-separated needs, IDs bare or backticked', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '',
    'Needs: `impl:a#1`, utest:a#1',
  ]);
  assert.equal(problems.length, 0);
  assert.deepEqual(items[0].needs, ['impl:a#1', 'utest:a#1']);
});

// Covers shares the same list machinery as Needs: every bullet marker and
// bare/backticked IDs must work identically, inline or as a bullet list.
for (const marker of ['-', '*', '+']) {
  test(`covers as "${marker}" bullet list, IDs bare or backticked`, () => {
    const { items, problems } = parse([
      '`req:a#1`',
      '',
      'Covers:',
      `${marker} \`feat:a#1\``,
      `${marker} feat:b#1`,
    ]);
    assert.equal(problems.length, 0);
    assert.deepEqual(items[0].covers, ['feat:a#1', 'feat:b#1']);
  });
}

test('inline comma-separated covers, IDs bare or backticked', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '',
    'Covers: `feat:a#1`, feat:b#1',
  ]);
  assert.equal(problems.length, 0);
  assert.deepEqual(items[0].covers, ['feat:a#1', 'feat:b#1']);
});

test('invalid ID in a Needs list is reported as a problem', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '',
    'Needs: not/valid, impl:ok#1',
  ]);
  assert.deepEqual(items[0].needs, ['impl:ok#1']);
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /not\/valid/);
  assert.equal(problems[0].file, 'spec.md');
});

test('a wildcard revision is accepted in Needs but not in Covers', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '',
    'Needs: impl:a#2.x, impl:b#2.3.x',
    '',
    'Covers: feat:x#1.y',
  ]);
  assert.deepEqual(items[0].needs, ['impl:a#2.x', 'impl:b#2.3.x']);
  assert.deepEqual(items[0].covers, []);
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /invalid ID "feat:x#1\.y" in Covers/);
});

test('a wildcard revision is not accepted in an item definition', () => {
  const { items } = parse(['`req:a#2.x`']);
  assert.equal(items.length, 0);
});

test('a short form takes the [group/]name from the item when only the revision is written', () => {
  const { items, problems } = parse([
    '`req:auth/login#1`',
    '',
    'Needs: impl#2, `utest#2.x`',
  ]);
  assert.equal(problems.length, 0);
  assert.deepEqual(items[0].needs, ['impl:auth/login#2', 'utest:auth/login#2.x']);
});

test('a short form takes the revision from the item when only a name is written', () => {
  const { items, problems } = parse([
    '`req:auth/login#3`',
    '',
    'Needs: impl, impl:other, dsn:auth/audit',
  ]);
  assert.equal(problems.length, 0);
  // impl -> name and revision both taken; impl:other / dsn:auth/audit -> revision taken
  assert.deepEqual(items[0].needs, ['impl:auth/login#3', 'impl:other#3', 'dsn:auth/audit#3']);
});

test('a bare type takes both the name and the revision from an ungrouped item', () => {
  const { items, problems } = parse(['`req:a#1`', '', 'Needs: impl']);
  assert.equal(problems.length, 0);
  assert.deepEqual(items[0].needs, ['impl:a#1']);
});

test('a short-form need in a table column is completed like an inline entry', () => {
  const { items, problems } = parse([
    '`req:auth/login#1`',
    '',
    '| Needs   |',
    '|---------|',
    '| impl    |',
  ]);
  assert.equal(problems.length, 0);
  assert.deepEqual(items[0].needs, ['impl:auth/login#1']);
});

test('a short-form Covers entry is completed from the item, like a Needs entry', () => {
  const { items, problems } = parse([
    '`impl:auth/login#2`',
    '',
    'Covers: feat, req:auth#1, dsn#2',
  ]);
  assert.equal(problems.length, 0);
  // feat -> name and revision taken; req:auth#1 -> full; dsn#2 -> name taken
  assert.deepEqual(items[0].covers, ['feat:auth/login#2', 'req:auth#1', 'dsn:auth/login#2']);
});

test('a wildcard revision is rejected in a short-form Covers entry', () => {
  const { items, problems } = parse(['`impl:auth/login#1`', '', 'Covers: feat#2.x']);
  assert.deepEqual(items[0].covers, []);
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /invalid ID "feat#2\.x" in Covers/);
});

test('an item definition ends at the next ID line or heading', () => {
  const { items } = parse([
    '`req:a#1`',
    'Needs: impl:a#1',
    '`req:b#1`',
    '',
    '# Later heading',
    'Needs: impl:stray#1',
  ]);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0].needs, ['impl:a#1']);
  assert.deepEqual(items[1].needs, []);
});

test('revisions may carry up to three semver-style layers', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '',
    '`req:b#2.4`',
    '',
    '`req:c#2.4.0`',
  ]);
  assert.equal(problems.length, 0);
  assert.deepEqual(
    items.map((item) => item.id),
    ['req:a#1', 'req:b#2.4', 'req:c#2.4.0'],
  );
  assert.deepEqual(
    items.map((item) => item.revision),
    ['1', '2.4', '2.4.0'],
  );
  assert.equal(items[1].key, 'req:b');
});

test('a fourth revision layer is not a valid ID definition', () => {
  const { items } = parse(['`req:a#1.2.3.4`']);
  assert.equal(items.length, 0);
});

test('a revision with a pre-release appendix is not a valid ID definition', () => {
  const { items } = parse(['`req:a#1.0.0-rc.1`']);
  assert.equal(items.length, 0);
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

test('standalone forwarding line, plain or backticked, spaces optional', () => {
  const { items, forwards } = parse([
    '[req:login#1 --> dsn:auth#2]',
    '',
    '`[req:logout#1-->dsn:auth#2]`',
  ]);
  assert.equal(items.length, 0);
  assert.deepEqual(forwards, [
    { from: 'req:login#1', to: 'dsn:auth#2', file: 'spec.md', line: 1, character: 1 },
    { from: 'req:logout#1', to: 'dsn:auth#2', file: 'spec.md', line: 3, character: 1 },
  ]);
});

test('a forwarding line inside an item body is not description', () => {
  const { items, forwards } = parse([
    '`req:a#1`',
    '',
    'The description.',
    '[req:a#1 --> dsn:b#1]',
    'Still the description.',
  ]);
  assert.deepEqual(items[0].description, ['The description.', 'Still the description.']);
  assert.equal(forwards.length, 1);
  assert.deepEqual(forwards[0], {
    from: 'req:a#1',
    to: 'dsn:b#1',
    file: 'spec.md',
    line: 4,
    character: 1,
  });
});

test('a forwarding mentioned in prose is not recognized', () => {
  const { forwards } = parse(['The tag [req:a#1 --> dsn:b#1] in prose does not forward.']);
  assert.equal(forwards.length, 0);
});

test('needs from a table column among irrelevant columns, IDs bare or backticked', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '',
    '| Feature | Needs | Owner |',
    '|---|---|---|',
    '| Login | `impl:a#1` | Alice |',
    '| Logout | utest:a#1 | Bob |',
  ]);
  assert.equal(problems.length, 0);
  assert.deepEqual(items[0].needs, ['impl:a#1', 'utest:a#1']);
});

test('one table may feed Needs, Covers, and Tags columns at once', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '',
    '| Needs | Covers | Tags |',
    '| :--- | ----: | :-: |',
    '| impl:a#1 | feat:a#1 | Auth |',
    '| utest:a#1 | | Security |',
  ]);
  assert.equal(problems.length, 0);
  assert.deepEqual(items[0].needs, ['impl:a#1', 'utest:a#1']);
  assert.deepEqual(items[0].covers, ['feat:a#1']);
  assert.deepEqual(items[0].tags, ['Auth', 'Security']);
});

test('empty and missing keyword cells are skipped', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '',
    '| Feature | Needs |',
    '|---|---|',
    '| Login | impl:a#1 |',
    '| Empty cell | |',
    '| Row too short |',
  ]);
  assert.equal(problems.length, 0);
  assert.deepEqual(items[0].needs, ['impl:a#1']);
});

test('invalid ID in a table cell is reported with the row line', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '',
    '| Needs |',
    '|---|',
    '| impl:ok#1 |',
    '| not/valid |',
  ]);
  assert.deepEqual(items[0].needs, ['impl:ok#1']);
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /invalid ID "not\/valid" in the Needs column of req:a#1/);
  assert.equal(problems[0].line, 6);
});

test('a wildcard revision is accepted in a Needs column but not in a Covers column', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '',
    '| Needs | Covers |',
    '|---|---|',
    '| impl:a#2.x | feat:x#1.y |',
  ]);
  assert.deepEqual(items[0].needs, ['impl:a#2.x']);
  assert.deepEqual(items[0].covers, []);
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /invalid ID "feat:x#1\.y" in the Covers column of req:a#1/);
});

test('a table without a keyword header cell stays plain text', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '',
    '| Feature | Owner |',
    '|---|---|',
    '| Login | impl:a#1 |',
  ]);
  assert.equal(problems.length, 0);
  assert.deepEqual(items[0].needs, []);
});

test('a keyword header row without a delimiter row is not a table', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '',
    '| Needs |',
    '| impl:a#1 |',
  ]);
  assert.equal(problems.length, 0);
  assert.deepEqual(items[0].needs, []);
});

// GFM renders tables without leading/trailing pipes too; the tracer must
// recognize them as well - only at least one pipe per row is required.
test('keyword table without leading/trailing pipes', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '',
    'Feature | Needs | Owner',
    '--- | --- | ---',
    'Login | impl:a#1 | Alice',
    'Logout | utest:a#1 | Bob',
  ]);
  assert.equal(problems.length, 0);
  assert.deepEqual(items[0].needs, ['impl:a#1', 'utest:a#1']);
});

// A pipe-less setext title line ends the table like any block element and
// becomes the next item's title.
test('a keyword table ends at a setext heading directly below it', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '',
    '| Needs |',
    '|---|',
    '| impl:a#1 |',
    'Next Title',
    '==========',
    '`req:b#1`',
  ]);
  assert.equal(problems.length, 0);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0].needs, ['impl:a#1']);
  assert.equal(items[1].title, 'Next Title');
});

// A `===` run directly under a table row is swallowed as a single-cell row
// (GFM), not a heading underline. Here it fills the Needs column, surfacing as
// an invalid entry rather than vanishing. The ID line below is swallowed the
// same way - a row of the item above, not a definition.
test('an underline directly under a table is a row filling the first column, not a heading', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '',
    '| Needs |',
    '|---|',
    '| impl:a#1 |',
    '| impl:b#1 |',
    '===========',
    '`req:b#1`',
  ]);
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /invalid ID "===========" in the Needs column of req:a#1/);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].needs, ['impl:a#1', 'impl:b#1', 'req:b#1']);
});

// A `---` run of three or more dashes directly under a table row is a thematic
// break (GFM): it ends the table - no row (nothing reported for the keyword
// column) and no underline (the row above stays a row).
test('a thematic break directly under a table ends it', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '',
    '| Needs | Covers |',
    '|---|---|',
    '| impl:a#1 | feat:a#1 |',
    '---',
    '`req:b#1`',
  ]);
  assert.equal(problems.length, 0);
  assert.equal(items.length, 2);
  assert.equal(items[0].id, 'req:a#1');
  assert.deepEqual(items[0].needs, ['impl:a#1']);
  assert.deepEqual(items[0].covers, ['feat:a#1']);
  assert.equal(items[1].id, 'req:b#1');
  assert.equal(items[1].title, null);
});

// The break truly ends the table: a row-shaped line below it belongs to no
// table (a lone pipe-carrying line starts none) and contributes nothing.
test('a row-shaped line below a thematic break is not part of the table', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '',
    '| Feature | Needs |',
    '|---|---|',
    '| Login | impl:a#1 |',
    '---',
    '| Logout | impl:b#1 |',
  ]);
  assert.equal(problems.length, 0);
  assert.deepEqual(items[0].needs, ['impl:a#1']);
});

// A dash run too short for a thematic break (`-`, `--`) is no block
// element - like `===`, it is swallowed as a single-cell row, and the
// table continues past it.
test('a dash run too short for a thematic break is swallowed as a row', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '',
    '| Needs |',
    '|---|',
    '| impl:a#1 |',
    '--',
    '| impl:b#1 |',
  ]);
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /invalid ID "--" in the Needs column of req:a#1/);
  assert.deepEqual(items[0].needs, ['impl:a#1', 'impl:b#1']);
});

// A swallowed underline fills only the first column: when no keyword column
// sits there, it feeds an ignored column and surfaces nowhere. The blank
// line ends the table, keeping the ID below a definition.
test('a swallowed underline is silent when the first column is not a keyword column', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '',
    '| Feature | Needs |',
    '|---|---|',
    '| Login | impl:a#1 |',
    '=================',
    '',
    '`req:b#1`',
  ]);
  assert.equal(problems.length, 0);
  assert.deepEqual(items[0].needs, ['impl:a#1']);
  assert.equal(items[1].title, null);
});

// The swallowed underline does not end the table: rows below it still
// belong to the table and contribute their entries.
test('a table continues past a swallowed underline', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '',
    '| Feature | Needs |',
    '|---|---|',
    '| Login | impl:a#1 |',
    '===',
    '| Logout | impl:b#1 |',
  ]);
  assert.equal(problems.length, 0);
  assert.deepEqual(items[0].needs, ['impl:a#1', 'impl:b#1']);
});

// Any pipe-carrying line under a table is a row, even underlined and even when
// it reads like prose: its cells feed the keyword columns, so an invalid entry
// is reported rather than becoming a title. The underline below is a row too.
test('a pipe-carrying line under a table is a row even when underlined', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '',
    '| Needs |',
    '|---|',
    '| impl:a#1 |',
    'Next | Title',
    '=============',
    '',
    '`req:b#1`',
  ]);
  // Both `Next | Title` and the `====` run are rows of the table, not a setext
  // heading, so their first column is read as a Needs cell. `Next` is a valid
  // type on its own, so it completes to the short-form need Next:a#1; the `====`
  // run is not a valid reference and is reported.
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /invalid ID "=============" in the Needs column of req:a#1/);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0].needs, ['impl:a#1', 'Next:a#1']);
  assert.equal(items[1].title, null);
});

// A table without keyword columns is informative text, but its rows are
// still pipe-carrying lines - an underline below the last one neither makes
// it a title nor terminates anything.
test('an informative table row above an underline is not a heading', () => {
  const { items } = parse([
    '`req:a#1`',
    'Description of a.',
    '',
    '| Feature | Owner |',
    '|---|---|',
    '| Login | Alice |',
    '=================',
    '',
    '`req:b#1`',
  ]);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0].description, ['Description of a.']);
  assert.equal(items[1].title, null);
});

// A table cannot define an item: a cell holding nothing but a backticked ID is
// reported, no item created - for any table, keyword-carrying or informative.
test('an item defined inside a table cell is flagged and creates no item', () => {
  const { items, problems } = parse([
    '| ID | Owner |',
    '|---|---|',
    '| `req:x#1` | Alice |',
  ]);
  assert.equal(items.length, 0);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].line, 3);
  assert.match(problems[0].message, /item req:x#1 defined inside a table; a table cell is not an item definition/);
});

// Keyword columns hold entries, optionally backticked - a backticked ID
// there is an entry, never a flagged definition attempt.
test('a backticked ID in a keyword column is an entry, not a flagged definition', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '',
    '| Needs |',
    '|---|',
    '| `impl:a#1` |',
  ]);
  assert.equal(problems.length, 0);
  assert.deepEqual(items[0].needs, ['impl:a#1']);
});

// The flag also fires in the non-keyword columns of a keyword table.
test('a definition-shaped cell outside the keyword columns is flagged', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '',
    '| Feature | Needs |',
    '|---|---|',
    '| `req:x#1` | impl:a#1 |',
  ]);
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /item req:x#1 defined inside a table/);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].needs, ['impl:a#1']);
});

// An ID line directly under a table (no blank line) is a swallowed single-cell
// row (GFM), defining nothing. In a keyword column it is an entry (see above);
// elsewhere it is a definition-shaped cell and is flagged.
test('an ID line directly under a table is a swallowed row, not a definition', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '',
    '| Feature | Needs |',
    '|---|---|',
    '| Login | impl:a#1 |',
    '`req:b#1`',
  ]);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].needs, ['impl:a#1']);
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /item req:b#1 defined inside a table; a table cell is not an item definition/);
});

test('a pipe-bearing heading ends the table like any block element', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '',
    'Needs |',
    '--- |',
    'impl:a#1 |',
    '## Next | chapter',
    '`req:b#1`',
  ]);
  assert.equal(problems.length, 0);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0].needs, ['impl:a#1']);
});

// GFM degrades a table whose delimiter row has a deviating cell count to
// plain text; the tracer must agree with the rendered document.
test('a delimiter row with a mismatched cell count is not a table', () => {
  const { items, problems } = parse([
    '`req:a#1`',
    '',
    '| A | Needs |',
    '|---|',
    '| x | impl:a#1 |',
  ]);
  assert.equal(problems.length, 0);
  assert.deepEqual(items[0].needs, []);
});

test('a keyword table terminates the description like a keyword line', () => {
  const { items } = parse([
    '`req:a#1`',
    '',
    'The description.',
    '| Needs |',
    '|---|',
    '| impl:a#1 |',
    'Not description anymore.',
  ]);
  assert.deepEqual(items[0].description, ['The description.']);
  assert.deepEqual(items[0].needs, ['impl:a#1']);
});
