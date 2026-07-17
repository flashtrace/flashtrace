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

// A table delimiter row carries pipes, so it is never a setext underline.
test('a table delimiter row is not mistaken for a setext heading', () => {
  const { items } = parse(['| Feature | Owner |', '| --- | --- |', '`req:a#1`']);
  assert.equal(items[0].title, null);
});

// A run of `-` directly below a bullet ends the list; it is not a heading.
test('a bullet list above a run of dashes is not a setext heading', () => {
  const { items } = parse(['- item one', '- item two', '---', '`req:a#1`']);
  assert.equal(items[0].title, null);
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
    items.map((it) => it.id),
    ['req:a#1', 'req:b#2.4', 'req:c#2.4.0'],
  );
  assert.deepEqual(
    items.map((it) => it.revision),
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
    { from: 'req:login#1', to: 'dsn:auth#2', file: 'spec.md', line: 1 },
    { from: 'req:logout#1', to: 'dsn:auth#2', file: 'spec.md', line: 3 },
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
  assert.deepEqual(forwards[0], { from: 'req:a#1', to: 'dsn:b#1', file: 'spec.md', line: 4 });
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
  assert.match(problems[0].message, /invalid ID "not\/valid" in Needs/);
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
  assert.match(problems[0].message, /invalid ID "feat:x#1\.y" in Covers/);
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
