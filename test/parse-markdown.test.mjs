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
  assert.equal(item.revision, 1);
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
