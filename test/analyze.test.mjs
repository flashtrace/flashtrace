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

const byId = (items, id) => items.find((item) => item.id === id);

test('a need satisfied by an existing item yields no defects', () => {
  const items = run({
    md: ['`req:a#1`', '', 'Needs: impl:a#1'],
    code: ['// [impl:a#1]'],
  });
  for (const item of items) assert.deepEqual(item.defects, []);
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

test('matching stays exact per layer: 2.4 does not satisfy a need for 2.4.0', () => {
  const items = run({
    md: ['`req:a#1`', '', 'Needs: impl:a#2.4.0'],
    code: ['// [impl:a#2.4]'],
  });
  const [defect] = byId(items, 'req:a#1').defects;
  assert.match(defect, /^uncovered: needs impl:a#2\.4\.0/);
  // the near-miss revision is offered as a hint
  assert.match(defect, /revision mismatch/);
  assert.match(defect, /2\.4(?!\.)/);
});

test('an exact multi-layer revision need is covered', () => {
  const items = run({
    md: ['`req:a#1`', '', 'Needs: impl:a#2.4.0'],
    code: ['// [impl:a#2.4.0]'],
  });
  for (const item of items) assert.deepEqual(item.defects, []);
  assert.equal(byId(items, 'req:a#1').deepCovered, true);
});

test('revision-mismatch hints are ordered semver-aware', () => {
  const items = run({
    md: [
      '`req:a#1`',
      '',
      'Needs: impl:a#9',
      '',
      '`impl:a#2.10`',
      '',
      '`impl:a#2.9`',
      '',
      '`impl:a#2.9.0`',
    ],
  });
  const [defect] = byId(items, 'req:a#1').defects;
  assert.match(defect, /existing revision\(s\) of impl:a: 2\.9, 2\.9\.0, 2\.10/);
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
  for (const item of items) assert.deepEqual(item.defects, []);
});

test('defining the same full ID twice flags both as duplicates', () => {
  const items = run({ md: ['`req:a#1`', '', '`req:a#1`'] });
  assert.equal(items.length, 2);
  for (const item of items) assert.match(item.defects[0], /^duplicate: ID req:a#1/);
});

test('a wildcard need is satisfied by any matching concrete item', () => {
  const items = run({
    md: ['`req:a#1`', '', 'Needs: impl:a#2.x'],
    code: ['// [impl:a#2.5]'],
  });
  for (const item of items) assert.deepEqual(item.defects, []);
  assert.equal(byId(items, 'req:a#1').deepCovered, true);
});

test('a wildcard matches only within the same layer count', () => {
  const items = run({
    md: ['`req:a#1`', '', 'Needs: impl:a#2.x'],
    code: ['// [impl:a#2.5.0]'],
  });
  assert.match(byId(items, 'req:a#1').defects[0], /^uncovered: needs impl:a#2\.x/);
  // the near-miss item is not what the wildcard asked for, so it stays unwanted
  assert.match(byId(items, 'impl:a#2.5.0').defects[0], /^unwanted: no item needs/);
});

test('three-layer wildcards match any tail of the same shape', () => {
  const items = run({
    md: ['`req:a#1`', '', 'Needs: impl:a#2.3.x, impl:b#2.x.y'],
    code: ['// [impl:a#2.3.7]', '// [impl:b#2.9.4]'],
  });
  for (const item of items) assert.deepEqual(item.defects, []);
  assert.equal(byId(items, 'req:a#1').deepCovered, true);
});

test('a covers entry satisfies a wildcard need on its target', () => {
  const items = run({
    md: [
      '`feat:auth#1`',
      '',
      'Needs: impl:a#2.x',
      '',
      '`impl:a#2.5`',
      '',
      'Covers: feat:auth#1',
    ],
  });
  for (const item of items) assert.deepEqual(item.defects, []);
});

test('a wildcard need is shallow-covered but not deep when its match is defective', () => {
  const items = run({
    md: [
      '`req:a#1`',
      '',
      'Needs: dsn:b#2.x',
      '',
      '`dsn:b#2.5`',
      '',
      'Needs: impl:c#1',
    ],
  });
  const reqA = byId(items, 'req:a#1');
  assert.deepEqual(reqA.defects, []); // its wildcard need is matched
  assert.equal(reqA.deepCovered, false); // but dsn:b#2.5 is itself uncovered
  assert.match(byId(items, 'dsn:b#2.5').defects[0], /^uncovered: needs impl:c#1/);
});

test('a wildcard need matching nothing is uncovered with a revision hint', () => {
  const items = run({
    md: ['`req:a#1`', '', 'Needs: impl:a#9.x'],
    code: ['// [impl:a#2.5]'],
  });
  const [defect] = byId(items, 'req:a#1').defects;
  assert.match(defect, /^uncovered: needs impl:a#9\.x/);
  assert.match(defect, /existing revision\(s\) of impl:a: 2\.5/);
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
  assert.equal(problems[0].severity, 'error');
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

test('cyclic forwarding is a problem and the forwardings have no effect', () => {
  const { items, problems } = runAll({
    md: [
      '`req:a#1`',
      '',
      'Needs: impl:missing#1',
      '',
      '`req:b#1`',
      '',
      '[req:a#1 --> req:b#1]',
      '[req:b#1 --> req:a#1]',
    ],
  });
  assert.equal(problems.length, 2);
  for (const problem of problems)
    assert.match(problem.message, /^cyclic forwarding: req:a#1 --> req:b#1 --> req:a#1$/);
  // the forwardings are inert: req:a#1 falls back to its own needs
  assert.match(byId(items, 'req:a#1').defects[0], /^uncovered: needs impl:missing#1/);
  assert.deepEqual(byId(items, 'req:b#1').defects, []);
});

test('a self-forwarding is a cyclic-forwarding problem', () => {
  const { problems } = runAll({
    md: ['`req:a#1`', '', '[req:a#1 --> req:a#1]'],
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /^cyclic forwarding: req:a#1 --> req:a#1$/);
  assert.equal(problems[0].severity, 'error');
});

test('an acyclic forwarding chain is allowed', () => {
  const { items, problems } = runAll({
    md: [
      '`req:a#1`',
      '',
      '`dsn:b#1`',
      '',
      '`impl:c#1`',
      '',
      '[req:a#1 --> dsn:b#1]',
      '[dsn:b#1 --> impl:c#1]',
    ],
  });
  assert.equal(problems.length, 0);
  for (const item of items) {
    assert.deepEqual(item.defects, []);
    assert.equal(item.deepCovered, true);
  }
});

test('cyclic needs do not hang and count as deep-covered', () => {
  const items = run({
    md: ['`req:a#1`', '', 'Needs: req:b#1', '', '`req:b#1`', '', 'Needs: req:a#1'],
  });
  for (const item of items) {
    assert.deepEqual(item.defects, []);
    assert.equal(item.deepCovered, true);
  }
});
