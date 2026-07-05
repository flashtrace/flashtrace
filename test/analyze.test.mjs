import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, parseCode, parseMarkdown } from '../src/main.mjs';

// Builds items through the real parsers so the shapes always match.
function runAll({ md = [], code = [] }) {
  const problems = [];
  const forwards = [];
  const items = [
    ...parseMarkdown('spec.md', md.join('\n'), problems, forwards),
    ...parseCode('src.ts', code.join('\n'), problems, forwards),
  ];
  assert.equal(problems.length, 0, 'fixture must parse cleanly');
  analyze(items, forwards, problems);
  return { items, problems };
}

function run(fixture) {
  return runAll(fixture).items;
}

const byId = (items, id) => items.find((it) => it.id === id);

test('a need satisfied by an existing item yields no defects', () => {
  const items = run({
    md: ['`req:a#1`', '', 'Needs: impl:a#1'],
    code: ['// [impl:a#1]'],
  });
  for (const it of items) assert.deepEqual(it.defects, []);
  assert.equal(byId(items, 'req:a#1').deepCovered, true);
});

test('a missing need is uncovered, with a revision-mismatch hint', () => {
  const items = run({
    md: ['`req:a#1`', '', 'Needs: impl:a#2'],
    code: ['// [impl:a#1]'],
  });
  const [defect] = byId(items, 'req:a#1').defects;
  assert.match(defect, /^uncovered: needs impl:a#2/);
  assert.match(defect, /revision mismatch/);
  assert.match(defect, /1/);
});

test('covering a non-existent item is orphaned', () => {
  const items = run({ md: ['`req:a#1`', '', 'Covers: feat:x#1'] });
  assert.match(byId(items, 'req:a#1').defects[0], /^orphaned: covers feat:x#1/);
});

test('covering an item that does not need you is unwanted', () => {
  const items = run({
    md: ['`feat:auth#1`', '', '`req:a#1`', '', 'Covers: feat:auth#1'],
  });
  assert.match(byId(items, 'req:a#1').defects[0], /^unwanted: covers feat:auth#1/);
});

test('a covers entry matched by the target’s needs is valid', () => {
  const items = run({
    md: [
      '`feat:auth#1`',
      '',
      'Needs: req:a#1',
      '',
      '`req:a#1`',
      '',
      'Covers: feat:auth#1',
    ],
  });
  for (const it of items) assert.deepEqual(it.defects, []);
});

test('defining the same full ID twice flags both as duplicates', () => {
  const items = run({ md: ['`req:a#1`', '', '`req:a#1`'] });
  assert.equal(items.length, 2);
  for (const it of items) assert.match(it.defects[0], /^duplicate: ID req:a#1/);
});

test('a code item nobody needs is unwanted', () => {
  const items = run({ code: ['// [impl:stray#1]'] });
  assert.match(byId(items, 'impl:stray#1').defects[0], /^unwanted: no item needs/);
});

test('a defect further down the chain breaks deep coverage only', () => {
  const items = run({
    md: [
      '`req:a#1`',
      '',
      'Needs: dsn:b#1',
      '',
      '`dsn:b#1`',
      '',
      'Needs: impl:c#1',
    ],
  });
  const reqA = byId(items, 'req:a#1');
  assert.deepEqual(reqA.defects, []); // its own need exists
  assert.equal(reqA.deepCovered, false); // but dsn:b is itself defective
  assert.match(byId(items, 'dsn:b#1').defects[0], /^uncovered/);
});

test('forwarding excuses the item’s own needs and follows the target', () => {
  const items = run({
    md: [
      '`req:login#1`',
      '',
      'Needs: impl:login#1',
      '',
      '[req:login#1 --> dsn:auth#2]',
      '',
      '`dsn:auth#2`',
    ],
  });
  const login = byId(items, 'req:login#1');
  assert.deepEqual(login.defects, []); // impl:login#1 missing, but excused
  assert.equal(login.deepCovered, true);
});

test('forwarding to a missing item is uncovered, with revision hint', () => {
  const items = run({
    md: ['`req:a#1`', '', '`dsn:b#1`', '', '[req:a#1 --> dsn:b#2]'],
  });
  const [defect] = byId(items, 'req:a#1').defects;
  assert.match(defect, /^uncovered: forwards to dsn:b#2, which does not exist/);
  assert.match(defect, /revision mismatch/);
});

test('forwarding from a non-existent item is a problem', () => {
  const { items, problems } = runAll({
    md: ['`dsn:b#1`', '', '[req:ghost#1 --> dsn:b#1]'],
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /^forwarding from req:ghost#1, which does not exist/);
  assert.deepEqual(byId(items, 'dsn:b#1').defects, []);
});

test('a second forwarding for the same item is a duplicate defect', () => {
  const items = run({
    md: [
      '`req:a#1`',
      '',
      '`dsn:b#1`',
      '',
      '`dsn:c#1`',
      '',
      '[req:a#1 --> dsn:b#1]',
      '[req:a#1 --> dsn:c#1]',
    ],
  });
  assert.match(
    byId(items, 'req:a#1').defects[0],
    /^duplicate: forwarding for req:a#1 is declared 2 times/,
  );
});

test('deep coverage of a forwarded item tracks the target’s chain', () => {
  const items = run({
    md: [
      '`req:a#1`',
      '',
      '[req:a#1 --> dsn:b#1]',
      '',
      '`dsn:b#1`',
      '',
      'Needs: impl:c#1',
    ],
  });
  const reqA = byId(items, 'req:a#1');
  assert.deepEqual(reqA.defects, []); // its target exists
  assert.equal(reqA.deepCovered, false); // but the target is uncovered itself
});

test('a code item referenced only as forwarding target is not unwanted', () => {
  const items = run({
    md: ['`req:a#1`', '', '[req:a#1 --> impl:b#1]'],
    code: ['// [impl:b#1]'],
  });
  assert.deepEqual(byId(items, 'impl:b#1').defects, []);
});

test('cyclic forwarding does not hang', () => {
  const items = run({
    md: [
      '`req:a#1`',
      '',
      '`req:b#1`',
      '',
      '[req:a#1 --> req:b#1]',
      '[req:b#1 --> req:a#1]',
    ],
  });
  for (const it of items) {
    assert.deepEqual(it.defects, []);
    assert.equal(it.deepCovered, true);
  }
});

test('cyclic needs do not hang and count as deep-covered', () => {
  const items = run({
    md: ['`req:a#1`', '', 'Needs: req:b#1', '', '`req:b#1`', '', 'Needs: req:a#1'],
  });
  for (const it of items) {
    assert.deepEqual(it.defects, []);
    assert.equal(it.deepCovered, true);
  }
});
