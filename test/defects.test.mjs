import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { DEFECT_KINDS, analyze, parseCode, parseMarkdown } from '../src/main.mjs';

const schema = JSON.parse(
  readFileSync(new URL('../schemas/report/v0.json', import.meta.url), 'utf8'),
);

// Builds items through the real parsers, as the other suites do, and returns
// the defect kinds raised per item ID.
function kindsById({ md = [], code = [] }) {
  const problems = [];
  const forwards = [];
  const items = [
    ...parseMarkdown('spec.md', md.join('\n'), problems, forwards),
    ...parseCode('src.ts', code.join('\n'), problems, forwards),
  ];
  analyze(items, forwards, problems);
  const kinds = new Map();
  for (const item of items)
    for (const defect of item.defects)
      (kinds.get(item.id) ?? kinds.set(item.id, []).get(item.id)).push(defect.kind);
  return kinds;
}

const kindsOf = (fixture, id) => (kindsById(fixture).get(id) ?? []).sort();

test('the schema lists exactly the kinds the code can raise', () => {
  assert.deepEqual(schema.$defs.defect.properties.kind.enum, [...DEFECT_KINDS]);
});

test('no kind is spelled twice', () => {
  assert.equal(new Set(DEFECT_KINDS).size, DEFECT_KINDS.length);
});

test('a need matching no item is uncovered-need', () => {
  assert.deepEqual(kindsOf({ md: ['`req:a#1`', '', 'Needs: impl:gone#1'] }, 'req:a#1'), [
    'uncovered-need',
  ]);
});

test('a forwarding to a missing target is uncovered-forward, not uncovered-need', () => {
  // the source declares a need of its own; forwarding excuses it, so the only
  // defect must be the forwarding one
  const fixture = {
    md: ['`req:a#1`', '', 'Needs: impl:gone#1', '', '`[req:a#1 --> dsn:gone#1]`'],
  };
  assert.deepEqual(kindsOf(fixture, 'req:a#1'), ['uncovered-forward']);
});

test('covering a missing item is orphaned-cover', () => {
  assert.deepEqual(kindsOf({ md: ['`req:a#1`', '', 'Covers: feat:gone#1'] }, 'req:a#1'), [
    'orphaned-cover',
  ]);
});

test('covering an item that does not need you is unwanted-cover', () => {
  const fixture = { md: ['`feat:auth#1`', '', '`req:a#1`', '', 'Covers: feat:auth#1'] };
  assert.deepEqual(kindsOf(fixture, 'req:a#1'), ['unwanted-cover']);
});

test('a code item nobody needs is unwanted-item', () => {
  assert.deepEqual(kindsOf({ code: ['// [impl:stray#1]'] }, 'impl:stray#1'), ['unwanted-item']);
});

test('unwanted-cover and unwanted-item stay apart within one run', () => {
  // both used to be plain "unwanted", separable only by comparing ref to the
  // item's own ID; now the kind says which is which
  const fixture = {
    md: ['`feat:auth#1`', '', '`req:a#1`', '', 'Covers: feat:auth#1'],
    code: ['// [impl:stray#1]'],
  };
  const kinds = kindsById(fixture);
  assert.deepEqual(kinds.get('req:a#1'), ['unwanted-cover']);
  assert.deepEqual(kinds.get('impl:stray#1'), ['unwanted-item']);
});

test('defining an ID twice is duplicate-id', () => {
  assert.deepEqual(kindsOf({ md: ['`req:a#1`', '', '`req:a#1`'] }, 'req:a#1'), [
    'duplicate-id',
    'duplicate-id',
  ]);
});

test('declaring two forwardings for one item is duplicate-forwarding', () => {
  const fixture = {
    md: [
      '`req:a#1`',
      '',
      '`dsn:b#1`',
      '',
      '`dsn:c#1`',
      '',
      '`[req:a#1 --> dsn:b#1]`',
      '`[req:a#1 --> dsn:c#1]`',
    ],
  };
  assert.deepEqual(kindsOf(fixture, 'req:a#1'), ['duplicate-forwarding']);
});

test('duplicate-id and duplicate-forwarding are distinct on the same item', () => {
  // both carry the item's own ID in `ref`, so before the split these two were
  // indistinguishable without reading the message
  const fixture = {
    md: [
      '`req:a#1`',
      '',
      '`req:a#1`',
      '',
      '`dsn:b#1`',
      '',
      '`dsn:c#1`',
      '',
      '`[req:a#1 --> dsn:b#1]`',
      '`[req:a#1 --> dsn:c#1]`',
    ],
  };
  assert.deepEqual(kindsOf(fixture, 'req:a#1'), [
    'duplicate-forwarding',
    'duplicate-forwarding',
    'duplicate-id',
    'duplicate-id',
  ]);
});
