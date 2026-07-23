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
  const [{ message: defect }] = byId(items, 'req:a#1').defects;
  assert.match(defect, /^uncovered: needs impl:a#2/);
  assert.match(defect, /revision mismatch/);
  assert.match(defect, /1/);
});

test('SemVer equality: an item at 2.4 satisfies a need for 2.4.0', () => {
  const items = run({
    md: ['`req:a#1`', '', 'Needs: impl:a#2.4.0'],
    code: ['// [impl:a#2.4]'],
  });
  for (const item of items) assert.deepEqual(item.defects, []);
  assert.equal(byId(items, 'req:a#1').deepCovered, true);
});

test('SemVer equality: an item at 1.0.0 satisfies a need for 1', () => {
  const items = run({
    md: ['`req:a#1`', '', 'Needs: impl:a#1'],
    code: ['// [impl:a#1.0.0]'],
  });
  for (const item of items) assert.deepEqual(item.defects, []);
  assert.equal(byId(items, 'req:a#1').deepCovered, true);
});

test('SemVer equality applies to covers and forwarding targets', () => {
  const items = run({
    md: [
      '`feat:auth#1`',
      '',
      'Needs: req:a#1',
      '',
      '`req:a#1.0`',
      '',
      'Covers: feat:auth#1.0.0',
      '',
      '`dsn:a#1`',
      '',
      '`req:b#1`',
      '',
      '[req:b#1.0 --> dsn:a#1.0.0]',
    ],
  });
  for (const item of items) assert.deepEqual(item.defects, []);
});

test('SemVer-equal spellings of one ID are duplicates, named canonically', () => {
  const items = run({ md: ['`req:a#2.4`', '', '`req:a#2.4.0`'] });
  assert.equal(items.length, 2);
  for (const item of items) assert.match(item.defects[0].message, /^duplicate: ID req:a#2\.4\.0 is defined 2 times/);
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
      '`impl:a#2.9.1`',
    ],
  });
  const [{ message: defect }] = byId(items, 'req:a#1').defects;
  assert.match(defect, /existing revision\(s\) of impl:a: 2\.9, 2\.9\.1, 2\.10/);
});

test('covering a non-existent item is orphaned', () => {
  const items = run({ md: ['`req:a#1`', '', 'Covers: feat:x#1'] });
  assert.match(byId(items, 'req:a#1').defects[0].message, /^orphaned: covers feat:x#1/);
});

test('covering an item that does not need you is unwanted', () => {
  const items = run({
    md: ['`feat:auth#1`', '', '`req:a#1`', '', 'Covers: feat:auth#1'],
  });
  assert.match(byId(items, 'req:a#1').defects[0].message, /^unwanted: covers feat:auth#1/);
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
  for (const item of items) assert.match(item.defects[0].message, /^duplicate: ID req:a#1/);
});

test('a wildcard need is satisfied by any matching concrete item', () => {
  const items = run({
    md: ['`req:a#1`', '', 'Needs: impl:a#2.x'],
    code: ['// [impl:a#2.5]'],
  });
  for (const item of items) assert.deepEqual(item.defects, []);
  assert.equal(byId(items, 'req:a#1').deepCovered, true);
});

test('a wildcard extends over the deeper layers: 2.x matches 2.5.0 and 2', () => {
  const items = run({
    md: ['`req:a#1`', '', 'Needs: impl:a#2.x, impl:b#2.x'],
    code: ['// [impl:a#2.5.0]', '// [impl:b#2]'],
  });
  for (const item of items) assert.deepEqual(item.defects, []);
  assert.equal(byId(items, 'req:a#1').deepCovered, true);
});

test('a wildcard still pins its numeric layers: 2.x does not match 3.1', () => {
  const items = run({
    md: ['`req:a#1`', '', 'Needs: impl:a#2.x'],
    code: ['// [impl:a#3.1]'],
  });
  assert.match(byId(items, 'req:a#1').defects[0].message, /^uncovered: needs impl:a#2\.x/);
  // the near-miss item is not what the wildcard asked for, so it stays unwanted
  assert.match(byId(items, 'impl:a#3.1').defects[0].message, /^unwanted: no item needs/);
});

test('a three-layer wildcard pins two layers: 2.3.x matches 2.3.7 but not 2.4.0', () => {
  const items = run({
    md: ['`req:a#1`', '', 'Needs: impl:a#2.3.x'],
    code: ['// [impl:a#2.3.7]', '// [impl:a#2.4.0]'],
  });
  assert.deepEqual(byId(items, 'req:a#1').defects, []);
  assert.match(byId(items, 'impl:a#2.4.0').defects[0].message, /^unwanted: no item needs/);
});

test('a bare x matches any revision, * is an alias for x', () => {
  const items = run({
    md: ['`req:a#1`', '', 'Needs: impl:a#x, impl:b#*, impl:c#2.*'],
    code: ['// [impl:a#4.1]', '// [impl:b#3.0.9]', '// [impl:c#2.7]'],
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
  assert.match(byId(items, 'dsn:b#2.5').defects[0].message, /^uncovered: needs impl:c#1/);
});

test('a wildcard need matching nothing is uncovered with a revision hint', () => {
  const items = run({
    md: ['`req:a#1`', '', 'Needs: impl:a#9.x'],
    code: ['// [impl:a#2.5]'],
  });
  const [{ message: defect }] = byId(items, 'req:a#1').defects;
  assert.match(defect, /^uncovered: needs impl:a#9\.x/);
  assert.match(defect, /existing revision\(s\) of impl:a: 2\.5/);
});

test('a code item nobody needs is unwanted', () => {
  const items = run({ code: ['// [impl:stray#1]'] });
  assert.match(byId(items, 'impl:stray#1').defects[0].message, /^unwanted: no item needs/);
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
  assert.match(byId(items, 'dsn:b#1').defects[0].message, /^uncovered/);
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
  const [{ message: defect }] = byId(items, 'req:a#1').defects;
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
    byId(items, 'req:a#1').defects[0].message,
    /^duplicate: forwarding for req:a#1 is declared 2 times/,
  );
});

test('SemVer-equal source spellings group into one duplicate forwarding', () => {
  const items = run({
    md: [
      '`req:a#1`',
      '',
      '`dsn:b#1`',
      '',
      '`dsn:c#1`',
      '',
      '[req:a#1 --> dsn:b#1]',
      '[req:a#1.0 --> dsn:c#1]',
    ],
  });
  const reqA = byId(items, 'req:a#1');
  // differing SemVer-equal spellings name the duplicate canonically, like a duplicate ID
  assert.match(reqA.defects[0].message, /^duplicate: forwarding for req:a#1\.0\.0 is declared 2 times/);
  assert.equal(reqA.forwardsTo, 'dsn:b#1'); // the first declaration stays effective
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

test('cyclic forwarding is a defect on every cycle member and the forwardings have no effect', () => {
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
  assert.equal(problems.length, 0);
  const cyclicA = byId(items, 'req:a#1').defects.find((defect) => defect.kind === 'cyclic-forwarding');
  assert.equal(cyclicA.ref, 'req:b#1');
  assert.match(
    cyclicA.message,
    /^cyclic: forwards to req:b#1, closing the cycle req:a#1 --> req:b#1 --> req:a#1, so the forwarding has no effect$/,
  );
  const cyclicB = byId(items, 'req:b#1').defects.find((defect) => defect.kind === 'cyclic-forwarding');
  assert.equal(cyclicB.ref, 'req:a#1');
  // the forwardings are inert: req:a#1 falls back to its own needs
  const uncovered = byId(items, 'req:a#1').defects.find((defect) => defect.kind === 'uncovered-need');
  assert.match(uncovered.message, /^uncovered: needs impl:missing#1/);
});

test('a self-forwarding is a cyclic-forwarding defect', () => {
  const { items, problems } = runAll({
    md: ['`req:a#1`', '', '[req:a#1 --> req:a#1]'],
  });
  assert.equal(problems.length, 0);
  const [defect] = byId(items, 'req:a#1').defects;
  assert.equal(defect.kind, 'cyclic-forwarding');
  assert.match(defect.message, /closing the cycle req:a#1 --> req:a#1/);
});

test('a cycle across SemVer-equal spellings is found and shown as written', () => {
  const { items, problems } = runAll({
    md: [
      '`req:a#1`',
      '',
      'Needs: impl:missing#1',
      '',
      '`req:b#1`',
      '',
      '[req:a#1 --> req:b#1]',
      '[req:b#1.0 --> req:a#1.0.0]',
    ],
  });
  assert.equal(problems.length, 0);
  // both cycle members carry a cyclic-forwarding defect; the chain names each
  // source as its declaration wrote it (SemVer-equal spellings shown verbatim)
  const cyclicA = byId(items, 'req:a#1').defects.find((defect) => defect.kind === 'cyclic-forwarding');
  assert.equal(cyclicA.ref, 'req:b#1');
  assert.match(
    cyclicA.message,
    /^cyclic: forwards to req:b#1, closing the cycle req:a#1 --> req:b#1\.0 --> req:a#1, so the forwarding has no effect$/,
  );
  const cyclicB = byId(items, 'req:b#1').defects.find((defect) => defect.kind === 'cyclic-forwarding');
  assert.equal(cyclicB.ref, 'req:a#1.0.0');
  // the forwardings are inert: req:a#1 falls back to its own needs
  assert.match(
    byId(items, 'req:a#1').defects.find((defect) => defect.kind !== 'cyclic-forwarding').message,
    /^uncovered: needs impl:missing#1/,
  );
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

// Source columns: what analyze raises over forwarding declarations - the
// missing-source problem, the cyclic-forwarding defect - carries the location
// of the declaration it points at.

test('a forwarding-from-missing-source problem carries the declaration column', () => {
  const { problems } = runAll({
    md: ['`dsn:b#1`', '', '  `[req:ghost#1 --> dsn:b#1]`'],
  });
  const problem = problems.find((p) => /forwarding from req:ghost#1/.test(p.message));
  assert.ok(problem);
  assert.equal(problem.line, 3);
  assert.equal(problem.character, 3); // the backtick, past two spaces
});

test('a duplicate-forwarding defect carries the first declaration location', () => {
  const items = run({
    md: [
      '`req:a#1`',
      '',
      '`dsn:b#1`',
      '',
      '`dsn:c#1`',
      '',
      '  `[req:a#1 --> dsn:b#1]`',
      '`[req:a#1 --> dsn:c#1]`',
    ],
  });
  const duplicate = byId(items, 'req:a#1').defects.find((defect) => defect.kind === 'duplicate-forwarding');
  assert.equal(duplicate.file, 'spec.md');
  assert.equal(duplicate.line, 7); // the first (effective) declaration
  assert.equal(duplicate.character, 3); // the backtick, past two spaces
});

test('a cyclic-forwarding defect carries the declaration location, not the item location', () => {
  const { items } = runAll({
    md: [
      '`req:a#1`',
      '',
      '  `[req:a#1 --> req:b#1]`',
      '',
      '`req:b#1`',
      '',
      '`[req:b#1 --> req:a#1]`',
    ],
  });
  const cyclicA = byId(items, 'req:a#1').defects.find((defect) => defect.kind === 'cyclic-forwarding');
  assert.equal(cyclicA.file, 'spec.md');
  assert.equal(cyclicA.line, 3);
  assert.equal(cyclicA.character, 3); // the backtick, past two spaces
  const cyclicB = byId(items, 'req:b#1').defects.find((defect) => defect.kind === 'cyclic-forwarding');
  assert.equal(cyclicB.file, 'spec.md');
  assert.equal(cyclicB.line, 7);
  assert.equal(cyclicB.character, 1);
});
