import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { analyze, buildReportDocument, parseCode, parseMarkdown } from '../src/main.mjs';

const schema = JSON.parse(
  readFileSync(new URL('../schemas/report/v0.json', import.meta.url), 'utf8'),
);

// Build the JSON document straight from the real parsers and analyze, so the
// shapes always match production. Markdown lands in docs/spec.md, code in
// src/impl.js; cwd is '' so the relative paths come out as those names.
function build({ md = [], code = [] }) {
  const problems = [];
  const forwards = [];
  const items = [
    ...parseMarkdown('docs/spec.md', md.join('\n'), problems, forwards),
    ...parseCode('src/impl.js', code.join('\n'), problems, forwards),
  ];
  analyze(items, forwards, problems);
  return buildReportDocument(items, forwards, problems, '', { version: '9.9.9' });
}

const itemOf = (document, id) => document.items.find((item) => item.id === id);

test('document: envelope, ordering and a resolved need', () => {
  const document = build({
    md: ['`req:a#1`', '', 'Needs: impl:a#1'],
    code: ['// [impl:a#1]'],
  });
  assert.equal(document.schemaVersion, 0);
  assert.equal(document.flashtrace, '9.9.9');
  assert.equal(document.ok, true);
  assert.deepEqual(document.forwards, []);

  // items are sorted by file, then line, then character
  assert.deepEqual(document.items.map((i) => i.id), ['req:a#1', 'impl:a#1']);

  const req = itemOf(document, 'req:a#1');
  assert.deepEqual(req, {
    id: 'req:a#1',
    title: null,
    origin: 'spec',
    tags: [],
    file: 'docs/spec.md',
    line: 1,
    character: 1,
    status: 'deep-covered',
    defective: false,
    deepCovered: true,
    needs: [{ ref: 'impl:a#1', resolvedTo: ['impl:a#1'] }],
    covers: [],
    forwardsTo: null,
    forwardedFrom: [],
    defects: [],
    wantedBy: [],
  });

  assert.deepEqual(document.summary, {
    items: 2,
    specItems: 1,
    codeItems: 1,
    okItems: 2,
    defectiveItems: 0,
    shallowCoveredItems: 0,
    problems: 0,
  });
});

test('a wildcard need resolves to every match in ascending revision order', () => {
  const document = build({
    md: ['`req:a#1`', '', 'Needs: impl:a#2.x'],
    code: ['// [impl:a#2.10]', '// [impl:a#2.2]'],
  });
  assert.deepEqual(itemOf(document, 'req:a#1').needs, [
    { ref: 'impl:a#2.x', resolvedTo: ['impl:a#2.2', 'impl:a#2.10'] },
  ]);
});

test('an uncovered need is a defect carrying the revision-mismatch data', () => {
  const document = build({
    md: ['`req:a#1`', '', 'Needs: impl:a#2'],
    code: ['// [impl:a#1]'],
  });
  const [defect] = itemOf(document, 'req:a#1').defects;
  // existingRevisions sits before message, per the documented key order
  assert.deepEqual(Object.keys(defect), ['kind', 'ref', 'existingRevisions', 'message']);
  assert.equal(defect.kind, 'uncovered-need');
  assert.equal(defect.ref, 'impl:a#2');
  assert.deepEqual(defect.existingRevisions, ['1']);
  assert.match(defect.message, /revision mismatch: existing revision\(s\) of impl:a: 1/);
  assert.equal(itemOf(document, 'req:a#1').status, 'defective');
});

test('covers entries are classified valid, unwanted or orphaned', () => {
  const document = build({
    md: [
      '`req:cover#1`',
      '',
      'Covers: req:wants#1, req:nowant#1, req:gone#1',
      '',
      '`req:wants#1`',
      '',
      'Needs: req:cover#1',
      '',
      '`req:nowant#1`',
    ],
  });
  const cover = itemOf(document, 'req:cover#1');
  assert.deepEqual(cover.covers, [
    { ref: 'req:wants#1', status: 'valid' },
    { ref: 'req:nowant#1', status: 'unwanted' },
    { ref: 'req:gone#1', status: 'orphaned' },
  ]);
  // a non-valid cover also surfaces as a defect on the same item
  assert.deepEqual(
    cover.defects.map((defect) => defect.kind).sort(),
    ['orphaned-cover', 'unwanted-cover'],
  );
});

test('defective and deepCovered are independent of each other', () => {
  // both items are defective for the same reason - an unwanted cover - but one
  // has a sound chain below it and the other does not. `status` says
  // "defective" for both; the booleans keep the two axes apart.
  const document = build({
    md: [
      '`feat:x#1`',
      '',
      '`req:clean#1`',
      '',
      'Needs: impl:a#1',
      '',
      'Covers: feat:x#1',
      '',
      '`req:broken#1`',
      '',
      'Needs: dsn:z#1',
      '',
      'Covers: feat:x#1',
      '',
      '`dsn:z#1`',
      '',
      'Needs: impl:gone#1',
    ],
    code: ['// [impl:a#1]'],
  });

  const clean = itemOf(document, 'req:clean#1');
  const broken = itemOf(document, 'req:broken#1');
  assert.equal(clean.status, broken.status, 'status collapses the two');
  assert.equal(clean.status, 'defective');

  assert.equal(clean.defective, true);
  assert.equal(clean.deepCovered, true); // fixing the cover leaves nothing below
  assert.equal(broken.defective, true);
  assert.equal(broken.deepCovered, false); // dsn:z#1 is itself uncovered
});

test('defective agrees with the defects array on every item', () => {
  const document = build({
    md: ['`req:a#1`', '', 'Needs: impl:gone#1', '', '`req:b#1`'],
    code: ['// [impl:stray#1]'],
  });
  for (const item of document.items)
    assert.equal(item.defective, item.defects.length > 0, `${item.id} disagrees`);
});

test('a valid cover stays valid on an item that is defective for another reason', () => {
  // cover status is read off the defects, so an unrelated defect on the same
  // item must not colour it
  const document = build({
    md: [
      '`req:wants#1`',
      '',
      'Needs: req:a#1',
      '',
      '`req:a#1`',
      '',
      'Covers: req:wants#1, req:gone#1',
      '',
      'Needs: impl:missing#1',
    ],
  });
  const item = itemOf(document, 'req:a#1');
  assert.deepEqual(item.covers, [
    { ref: 'req:wants#1', status: 'valid' },
    { ref: 'req:gone#1', status: 'orphaned' },
  ]);
  assert.deepEqual(item.defects.map((defect) => defect.kind).sort(), [
    'orphaned-cover',
    'uncovered-need',
  ]);
});

test('a forwarding source still has its covers classified', () => {
  // forwarding excuses the source's needs but not its covers
  const document = build({
    md: [
      '`req:legacy#1`',
      '',
      'Covers: req:nowant#1',
      '',
      '`req:nowant#1`',
      '',
      '`dsn:b#1`',
      '',
      '`[req:legacy#1 --> dsn:b#1]`',
    ],
  });
  assert.deepEqual(itemOf(document, 'req:legacy#1').covers, [
    { ref: 'req:nowant#1', status: 'unwanted' },
  ]);
});

test('status distinguishes deep-covered, shallow-covered and defective', () => {
  const document = build({
    md: [
      '`req:top#1`',
      '',
      'Needs: req:mid#1',
      '',
      '`req:mid#1`',
      '',
      'Needs: impl:missing#1',
    ],
  });
  assert.equal(itemOf(document, 'req:top#1').status, 'shallow-covered'); // chain broken below
  assert.equal(itemOf(document, 'req:mid#1').status, 'defective');
});

test('forwards and wantedBy record the reverse edges', () => {
  const document = build({
    md: [
      '`req:a#1`',
      '',
      'Needs: impl:a#1',
      '',
      '`req:legacy#1`',
      '',
      '`[req:legacy#1 --> req:a#1]`',
    ],
    code: ['// [impl:a#1]'],
  });

  assert.deepEqual(document.forwards, [
    { from: 'req:legacy#1', to: 'req:a#1', file: 'docs/spec.md', line: 7, character: 1, effective: true },
  ]);
  // impl:a#1 is wanted by req:a#1; forwarding demand is not counted here
  assert.deepEqual(itemOf(document, 'impl:a#1').wantedBy, [
    { id: 'req:a#1', file: 'docs/spec.md', line: 1, character: 1 },
  ]);
  assert.deepEqual(itemOf(document, 'req:a#1').wantedBy, []);
  assert.equal(itemOf(document, 'req:a#1').forwardsTo, null);
  assert.equal(itemOf(document, 'req:legacy#1').forwardsTo, 'req:a#1');

  // the forwarding demand wantedBy leaves out shows up here instead
  assert.deepEqual(itemOf(document, 'req:a#1').forwardedFrom, [
    { id: 'req:legacy#1', file: 'docs/spec.md', line: 5, character: 1 },
  ]);
  assert.deepEqual(itemOf(document, 'req:legacy#1').forwardedFrom, []);
});

test('forwardedFrom lists only effective forwardings', () => {
  // the duplicate declaration is voided, so dsn:c#1 is forwarded from nobody
  const document = build({
    md: [
      '`req:dup#1`',
      '',
      '`dsn:b#1`',
      '',
      '`dsn:c#1`',
      '',
      '`[req:dup#1 --> dsn:b#1]`',
      '`[req:dup#1 --> dsn:c#1]`',
    ],
  });
  assert.deepEqual(
    itemOf(document, 'dsn:b#1').forwardedFrom.map((ref) => ref.id),
    ['req:dup#1'],
  );
  assert.deepEqual(itemOf(document, 'dsn:c#1').forwardedFrom, []);
});

test('a forwarding to a missing target contributes no forwardedFrom anywhere', () => {
  const document = build({ md: ['`req:a#1`', '', '`[req:a#1 --> dsn:gone#1]`'] });
  assert.equal(itemOf(document, 'req:a#1').forwardsTo, 'dsn:gone#1');
  for (const item of document.items) assert.deepEqual(item.forwardedFrom, []);
});

test('forwards record every void reason and mirror forwardsTo', () => {
  const document = build({
    md: [
      '`req:dup#1`',
      '',
      '`dsn:b#1`',
      '',
      '`dsn:c#1`',
      '',
      '`[req:dup#1 --> dsn:b#1]`',
      '`[req:dup#1 --> dsn:c#1]`',
      '',
      '`req:eta#1`',
      '',
      '`[req:eta#1 --> req:eta#1]`',
      '',
      '`[req:ghost#1 --> dsn:b#1]`',
    ],
  });
  const reason = (from, to) =>
    document.forwards.find((f) => f.from === from && f.to === to);
  assert.equal(reason('req:dup#1', 'dsn:b#1').effective, true);
  assert.equal(reason('req:dup#1', 'dsn:b#1').voidedBy, undefined);
  assert.equal(reason('req:dup#1', 'dsn:c#1').voidedBy, 'duplicate');
  assert.equal(reason('req:eta#1', 'req:eta#1').voidedBy, 'cycle');
  assert.equal(reason('req:ghost#1', 'dsn:b#1').voidedBy, 'missing-source');
  // the effective declaration is the only one mirrored on the item
  assert.equal(itemOf(document, 'req:dup#1').forwardsTo, 'dsn:b#1');
});

test('problems are reported with location and fail the run without any defect', () => {
  const document = build({ code: ['// [>>utest:a#1]'] });
  assert.equal(document.ok, false);
  assert.deepEqual(document.problems, [
    {
      file: 'src/impl.js',
      line: 1,
      character: 4,
      message: 'need tag [>>utest:a#1] has no preceding item tag in this file',
    },
  ]);
  assert.equal(document.summary.defectiveItems, 0);
  assert.equal(document.summary.problems, 1);
});

test('a document carries every field the schema marks required', () => {
  // one document exercising every $def: an item with a resolved and an
  // uncovered need, a valid cover, a defect and an incoming wanter; an
  // effective and a voided forwarding; and a problem
  const document = build({
    md: [
      '`req:a#1`',
      '',
      'Needs: impl:a#1, dsn:missing#1',
      '',
      'Covers: req:b#1',
      '',
      '`req:b#1`',
      '',
      'Needs: req:a#1',
      '',
      '`req:legacy#1`',
      '',
      '`[req:legacy#1 --> req:a#1]`',
      '',
      '`[req:ghost#1 --> req:a#1]`',
    ],
    code: ['// [>>utest:orphan#1]', '// [impl:a#1]'],
  });

  const hasRequired = (object, definition, where) => {
    for (const key of definition.required) assert.ok(key in object, `${where} missing "${key}"`);
  };

  const req = itemOf(document, 'req:a#1');
  hasRequired(document, schema, 'document');
  hasRequired(req, schema.$defs.item, 'item');
  hasRequired(req.needs[0], schema.$defs.need, 'need');
  hasRequired(req.covers[0], schema.$defs.cover, 'cover');
  hasRequired(req.defects[0], schema.$defs.defect, 'defect');
  hasRequired(req.wantedBy[0], schema.$defs.itemRef, 'wantedBy entry');
  hasRequired(itemOf(document, 'req:a#1').forwardedFrom[0], schema.$defs.itemRef, 'forwardedFrom entry');
  hasRequired(document.forwards[0], schema.$defs.forward, 'forward');
  hasRequired(document.problems[0], schema.$defs.problem, 'problem');
  hasRequired(document.summary, schema.$defs.summary, 'summary');
});

test('building the document twice over the same items yields the same bytes', () => {
  // resolvedTo sorts the array matchesOf hands back in place; that is only safe
  // while matchesOf keeps returning a fresh one, so pin the guarantee here
  const problems = [];
  const forwards = [];
  const items = [
    ...parseMarkdown(
      'docs/spec.md',
      ['`req:a#1`', '', 'Needs: impl:a#2.x', '', '`req:b#1`', '', 'Needs: impl:a#2.x'].join('\n'),
      problems,
      forwards,
    ),
    ...parseCode('src/impl.js', ['// [impl:a#2.10]', '// [impl:a#2.2]'].join('\n'), problems, forwards),
  ];
  analyze(items, forwards, problems);

  const first = buildReportDocument(items, forwards, problems, '', { version: '9.9.9' });
  const second = buildReportDocument(items, forwards, problems, '', { version: '9.9.9' });
  assert.equal(JSON.stringify(first, null, 2), JSON.stringify(second, null, 2));
  // and the wildcard still resolves in ascending revision order both times
  for (const document of [first, second])
    assert.deepEqual(itemOf(document, 'req:a#1').needs[0].resolvedTo, [
      'impl:a#2.2',
      'impl:a#2.10',
    ]);
});

test('items, forwards and problems are sorted by file, line, character', () => {
  const document = build({
    md: ['`req:b#1`', '', '`req:a#1`'],
  });
  // two items on the same file: order follows line, not id
  assert.deepEqual(document.items.map((i) => i.id), ['req:b#1', 'req:a#1']);
  assert.deepEqual(document.items.map((i) => i.line), [1, 3]);
  for (const item of document.items) assert.ok(!item.file.includes('\\')); // forward slashes only
});

test('building a document without a version throws instead of dropping the field', () => {
  // JSON.stringify silently drops an undefined `flashtrace`, so the omission
  // must be refused up front rather than surface as a non-conforming document
  assert.throws(
    () => buildReportDocument([], [], [], ''),
    { name: 'TypeError', message: /opts\.version is required/ },
  );
});
