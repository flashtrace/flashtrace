/*
 * The JSON report against its published contract.
 *
 * Two halves. First a validator for the subset of JSON Schema that
 * schemas/report/v0.json uses, so types, enums and required fields are checked
 * rather than only field presence. Second the invariants the schema cannot
 * express - the inverse edges, the summary counts, the orderings - asserted on
 * every document the suite can lay hands on, including the committed e2e
 * snapshots.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { analyze, buildReportDocument, parseCode, parseMarkdown } from '../src/main.mjs';

const SCHEMA_URL = new URL('../schemas/report/v0.json', import.meta.url);
const schema = JSON.parse(readFileSync(SCHEMA_URL, 'utf8'));

// --- a validator for the schema subset this contract uses ------------------

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

function matchesType(value, type) {
  if (type === 'object') return isPlainObject(value);
  if (type === 'array') return Array.isArray(value);
  if (type === 'null') return value === null;
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'boolean') return typeof value === 'boolean';
  return typeof value === type;
}

const typeName = (value) => (value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value);

function validate(value, node, where, errors) {
  if (node.$ref) {
    const target = node.$ref.replace(/^#\//, '').split('/').reduce((step, key) => step[key], schema);
    assert.ok(target, `${where}: unresolvable $ref ${node.$ref}`);
    validate(value, target, where, errors);
    return;
  }
  if (node.oneOf) {
    const matched = node.oneOf.filter((branch) => {
      const branchErrors = [];
      validate(value, branch, where, branchErrors);
      return branchErrors.length === 0;
    });
    if (matched.length !== 1)
      errors.push(`${where}: matched ${matched.length} oneOf branches, expected exactly 1`);
    return;
  }
  if (node.const !== undefined && value !== node.const)
    errors.push(`${where}: expected ${JSON.stringify(node.const)}, got ${JSON.stringify(value)}`);
  if (node.enum && !node.enum.includes(value))
    errors.push(`${where}: ${JSON.stringify(value)} is not one of ${node.enum.join(', ')}`);
  if (node.type) {
    const types = Array.isArray(node.type) ? node.type : [node.type];
    if (!types.some((type) => matchesType(value, type)))
      errors.push(`${where}: expected ${types.join(' or ')}, got ${typeName(value)}`);
  }
  if (typeof node.minimum === 'number' && typeof value === 'number' && value < node.minimum)
    errors.push(`${where}: ${value} is below the minimum ${node.minimum}`);
  if (node.properties && isPlainObject(value)) {
    for (const key of node.required ?? [])
      if (!(key in value)) errors.push(`${where}: missing required field "${key}"`);
    for (const [key, child] of Object.entries(value)) {
      // The schema leaves unknown fields unconstrained so a consumer can read a
      // newer document. As the producer we hold ourselves to the stricter rule:
      // everything we emit must be described, or the schema has fallen behind.
      if (!node.properties[key]) {
        errors.push(`${where}: undocumented field "${key}"`);
        continue;
      }
      validate(child, node.properties[key], `${where}.${key}`, errors);
    }
  }
  if (node.items && Array.isArray(value))
    value.forEach((entry, index) => validate(entry, node.items, `${where}[${index}]`, errors));
}

function assertValid(document, label) {
  const errors = [];
  validate(document, schema, label, errors);
  assert.deepEqual(errors, [], `${label} does not match the schema:\n  ${errors.join('\n  ')}`);
}

// --- invariants the schema cannot express ----------------------------------

const pairs = (list) => new Set(list.map(([from, to]) => `${from} -> ${to}`));

function assertInvariants(document, label) {
  const items = document.items;
  const definedIds = new Set(items.map((item) => item.id));
  const at = (what) => `${label}: ${what}`;

  // status is the label; defective and deepCovered are the two axes behind it
  for (const item of items) {
    const expected = item.defective
      ? 'defective'
      : item.deepCovered
        ? 'deep-covered'
        : 'shallow-covered';
    assert.equal(item.status, expected, at(`${item.id} status disagrees with its booleans`));
    assert.equal(item.defective, item.defects.length > 0, at(`${item.id} defective disagrees`));
  }

  // covers[].status is the classification behind the cover defects
  for (const item of items) {
    const refsWith = (kind) =>
      new Set(item.defects.filter((defect) => defect.kind === kind).map((defect) => defect.ref));
    const coversWith = (status) =>
      new Set(item.covers.filter((cover) => cover.status === status).map((cover) => cover.ref));
    assert.deepEqual(coversWith('orphaned'), refsWith('orphaned-cover'), at(`${item.id} orphaned covers`));
    assert.deepEqual(coversWith('unwanted'), refsWith('unwanted-cover'), at(`${item.id} unwanted covers`));
  }

  // every resolvedTo entry names an item that exists
  for (const item of items)
    for (const need of item.needs)
      for (const id of need.resolvedTo)
        assert.ok(definedIds.has(id), at(`${item.id} needs ${need.ref} resolving to unknown ${id}`));

  // wantedBy is exactly the inverse of needs[].resolvedTo
  const wantsForward = pairs(
    items.flatMap((item) => item.needs.flatMap((need) => need.resolvedTo.map((id) => [item.id, id]))),
  );
  const wantsInverse = pairs(
    items.flatMap((item) => item.wantedBy.map((wanter) => [wanter.id, item.id])),
  );
  assert.deepEqual(wantsInverse, wantsForward, at('wantedBy is not the inverse of resolvedTo'));

  // forwardedFrom is exactly the inverse of forwardsTo, over existing targets
  const forwardsForward = pairs(
    items
      .filter((item) => item.forwardsTo !== null && definedIds.has(item.forwardsTo))
      .map((item) => [item.id, item.forwardsTo]),
  );
  const forwardsInverse = pairs(
    items.flatMap((item) => item.forwardedFrom.map((source) => [source.id, item.id])),
  );
  assert.deepEqual(forwardsInverse, forwardsForward, at('forwardedFrom is not the inverse of forwardsTo'));

  // forwardsTo mirrors exactly the effective declarations
  assert.deepEqual(
    pairs(items.filter((item) => item.forwardsTo !== null).map((item) => [item.id, item.forwardsTo])),
    pairs(document.forwards.filter((forward) => forward.effective).map((f) => [f.from, f.to])),
    at('forwardsTo does not mirror the effective forwards'),
  );

  // voidedBy is present exactly when the declaration is not effective
  for (const forward of document.forwards)
    assert.equal(
      'voidedBy' in forward,
      !forward.effective,
      at(`voidedBy presence on ${forward.from} --> ${forward.to}`),
    );

  // existingRevisions accompanies the hint in the message, and only then
  for (const item of items)
    for (const defect of item.defects)
      assert.equal(
        'existingRevisions' in defect,
        defect.message.includes('(revision mismatch:'),
        at(`${item.id} defect ${defect.kind} existingRevisions presence`),
      );

  // the summary counts what the arrays hold
  const defectiveItems = items.filter((item) => item.defective).length;
  const specItems = items.filter((item) => item.origin === 'spec').length;
  assert.deepEqual(
    document.summary,
    {
      items: items.length,
      specItems,
      codeItems: items.length - specItems,
      okItems: items.length - defectiveItems,
      defectiveItems,
      shallowCoveredItems: items.filter((item) => !item.defective && !item.deepCovered).length,
      problems: document.problems.length,
    },
    at('summary disagrees with the arrays'),
  );
  assert.equal(
    document.ok,
    defectiveItems === 0 && document.problems.length === 0,
    at('ok disagrees with the summary'),
  );

  // located arrays are sorted by file, then line, then character. Compare the
  // fields in that order: line and character are numbers, so any comparison
  // that stringifies them would call line 10 smaller than line 9.
  const byLocation = (a, b) => {
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    if (a.line !== b.line) return a.line - b.line;
    return a.character - b.character;
  };
  const sortKey = (entry) => [entry.file, entry.line, entry.character];
  for (const [name, list] of [
    ['items', items],
    ['forwards', document.forwards],
    ['problems', document.problems],
    ...items.map((item) => [`${item.id}.wantedBy`, item.wantedBy]),
    ...items.map((item) => [`${item.id}.forwardedFrom`, item.forwardedFrom]),
  ]) {
    const sorted = [...list].sort(byLocation);
    assert.deepEqual(list.map(sortKey), sorted.map(sortKey), at(`${name} is not sorted by location`));
  }

  // paths never leak a backslash, on any platform
  for (const entry of [...items, ...document.forwards, ...document.problems])
    assert.ok(!entry.file.includes('\\'), at(`${entry.file} carries a backslash`));
}

// --- a document exercising every $def --------------------------------------

// every kind of item, edge, defect, void reason and problem in one run
function buildEverything() {
  const md = [
    '# Titled',
    '`req:a#1`',
    '',
    'Tags: web',
    '',
    'Needs: impl:a#1, dsn:missing#2, impl:wild#3.x, not/valid',
    '',
    'Covers: req:wants#1, req:nowant#1, req:gone#1',
    '',
    '`req:wants#1`',
    '',
    'Needs: req:a#1',
    '',
    '`req:nowant#1`',
    '',
    '`req:legacy#1`',
    '',
    '`req:dup#1`',
    '',
    '`dsn:b#1`',
    '',
    '`dsn:c#1`',
    '',
    '`req:eta#1`',
    '',
    '`req:twice#1`',
    '',
    '`req:twice#1`',
    '',
    '`req:fwdgone#1`',
    '',
    '`[req:legacy#1 --> req:a#1]`',
    '`[req:dup#1 --> dsn:b#1]`',
    '`[req:dup#1 --> dsn:c#1]`',
    '`[req:eta#1 --> req:eta#1]`',
    '`[req:ghost#1 --> dsn:b#1]`',
    // target missing, but a sibling revision exists: uncovered-forward carrying
    // the revision-mismatch hint
    '`[req:fwdgone#1 --> dsn:b#9]`',
  ];
  const code = ['// [impl:a#1]', '// [impl:wild#3.2]', '// [impl:stray#1]', '// [>>utest:orphan#1]'];

  const problems = [];
  const forwards = [];
  const items = [
    ...parseMarkdown('docs/spec.md', md.join('\n'), problems, forwards),
    ...parseCode('src/impl.js', code.join('\n'), problems, forwards),
  ];
  analyze(items, forwards, problems);
  return buildReportDocument(items, forwards, problems, '', { version: '9.9.9' });
}

test('the reference document matches the schema and its invariants', () => {
  const document = buildEverything();
  assertValid(document, 'reference document');
  assertInvariants(document, 'reference document');
});

test('the reference document actually reaches every defect kind and void reason', () => {
  const document = buildEverything();
  const kinds = new Set(document.items.flatMap((item) => item.defects.map((defect) => defect.kind)));
  assert.deepEqual([...kinds].sort(), [...schema.$defs.defect.properties.kind.enum].sort());

  const reasons = new Set(
    document.forwards.filter((forward) => !forward.effective).map((forward) => forward.voidedBy),
  );
  assert.deepEqual([...reasons].sort(), [...schema.$defs.forward.properties.voidedBy.enum].sort());

  const statuses = new Set(document.items.map((item) => item.status));
  assert.deepEqual([...statuses].sort(), [...schema.$defs.item.properties.status.enum].sort());

  const coverStatuses = new Set(
    document.items.flatMap((item) => item.covers.map((cover) => cover.status)),
  );
  assert.deepEqual([...coverStatuses].sort(), [...schema.$defs.cover.properties.status.enum].sort());

  const origins = new Set(document.items.map((item) => item.origin));
  assert.deepEqual([...origins].sort(), [...schema.$defs.item.properties.origin.enum].sort());

  assert.ok(document.problems.length > 0, 'no problem reached');
});

// --- and every committed snapshot ------------------------------------------

const SNAPSHOT_DIR = new URL('./e2e-expect/', import.meta.url);
const snapshots = readdirSync(SNAPSHOT_DIR).filter((name) => name.endsWith('.json.txt'));

test('at least one JSON snapshot is committed', () => {
  assert.ok(snapshots.length > 0, 'no JSON snapshots found to check');
});

for (const name of snapshots) {
  test(`snapshot ${name} matches the schema and its invariants`, () => {
    const document = JSON.parse(readFileSync(new URL(name, SNAPSHOT_DIR), 'utf8'));
    assertValid(document, name);
    assertInvariants(document, name);
  });
}
