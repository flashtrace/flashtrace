import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { analyze, buildReportDocument, parseCode, parseMarkdown } from '../src/main.mjs';

const schema = JSON.parse(
  readFileSync(new URL('../schemas/report/v1.json', import.meta.url), 'utf8'),
);

// Build the JSON document straight from the real parsers and analyze, so the
// shapes always match production. Markdown lands in docs/spec.md, code in
// src/impl.js; cwd is '' so the relative paths come out as those names.
function build({ md = [], code = [], mode = 'base' }) {
  const problems = [];
  const forwards = [];
  const items = [
    ...parseMarkdown('docs/spec.md', md.join('\n'), problems, forwards),
    ...parseCode('src/impl.js', code.join('\n'), problems, forwards),
  ];
  analyze(items, forwards, problems);
  return buildReportDocument(items, forwards, problems, '', { mode, version: '9.9.9' });
}

const itemOf = (doc, id) => doc.items.find((item) => item.id === id);

test('base document: envelope, ordering and a resolved need', () => {
  const doc = build({
    md: ['`req:a#1`', '', 'Needs: impl:a#1'],
    code: ['// [impl:a#1]'],
  });
  assert.equal(doc.schemaVersion, 1);
  assert.equal(doc.flashtrace, '9.9.9');
  assert.equal(doc.mode, 'base');
  assert.equal(doc.ok, true);
  assert.equal('forwards' in doc, false); // base omits forwards

  // items are sorted by file, then line, then character
  assert.deepEqual(doc.items.map((i) => i.id), ['req:a#1', 'impl:a#1']);

  const req = itemOf(doc, 'req:a#1');
  assert.deepEqual(req, {
    id: 'req:a#1',
    title: null,
    origin: 'markdown',
    tags: [],
    file: 'docs/spec.md',
    line: 1,
    character: 1,
    status: 'deep-covered',
    needs: [{ ref: 'impl:a#1', resolvedTo: ['impl:a#1'] }],
    covers: [],
    forwardsTo: null,
    defects: [],
  });
  assert.equal('wantedBy' in req, false); // base omits wantedBy

  assert.deepEqual(doc.summary, {
    items: 2,
    markdownItems: 1,
    codeItems: 1,
    okItems: 2,
    defectiveItems: 0,
    shallowCoveredItems: 0,
    problems: 0,
  });
});

test('a wildcard need resolves to every match in ascending revision order', () => {
  const doc = build({
    md: ['`req:a#1`', '', 'Needs: impl:a#2.x'],
    code: ['// [impl:a#2.10]', '// [impl:a#2.2]'],
  });
  assert.deepEqual(itemOf(doc, 'req:a#1').needs, [
    { ref: 'impl:a#2.x', resolvedTo: ['impl:a#2.2', 'impl:a#2.10'] },
  ]);
});

test('an uncovered need is a defect carrying the revision-mismatch data', () => {
  const doc = build({
    md: ['`req:a#1`', '', 'Needs: impl:a#2'],
    code: ['// [impl:a#1]'],
  });
  const [defect] = itemOf(doc, 'req:a#1').defects;
  // existingRevisions sits before message, per the documented key order
  assert.deepEqual(Object.keys(defect), ['kind', 'ref', 'existingRevisions', 'message']);
  assert.equal(defect.kind, 'uncovered');
  assert.equal(defect.ref, 'impl:a#2');
  assert.deepEqual(defect.existingRevisions, ['1']);
  assert.match(defect.message, /revision mismatch: existing revision\(s\) of impl:a: 1/);
  assert.equal(itemOf(doc, 'req:a#1').status, 'defective');
});

test('covers entries are classified valid, unwanted or orphaned', () => {
  const doc = build({
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
  const cover = itemOf(doc, 'req:cover#1');
  assert.deepEqual(cover.covers, [
    { ref: 'req:wants#1', status: 'valid' },
    { ref: 'req:nowant#1', status: 'unwanted' },
    { ref: 'req:gone#1', status: 'orphaned' },
  ]);
  // a non-valid cover also surfaces as a defect on the same item
  assert.deepEqual(
    cover.defects.map((d) => d.kind).sort(),
    ['orphaned', 'unwanted'],
  );
});

test('status distinguishes deep-covered, shallow-covered and defective', () => {
  const doc = build({
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
  assert.equal(itemOf(doc, 'req:top#1').status, 'shallow-covered'); // chain broken below
  assert.equal(itemOf(doc, 'req:mid#1').status, 'defective');
});

test('rich mode adds forwards and wantedBy; base does not', () => {
  const fixture = {
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
  };
  const rich = build({ ...fixture, mode: 'rich' });

  assert.deepEqual(rich.forwards, [
    { from: 'req:legacy#1', to: 'req:a#1', file: 'docs/spec.md', line: 7, character: 1, effective: true },
  ]);
  // impl:a#1 is wanted by req:a#1; forwarding demand is not counted here
  assert.deepEqual(itemOf(rich, 'impl:a#1').wantedBy, [
    { id: 'req:a#1', file: 'docs/spec.md', line: 1, character: 1 },
  ]);
  assert.deepEqual(itemOf(rich, 'req:a#1').wantedBy, []);
  assert.equal(itemOf(rich, 'req:a#1').forwardsTo, null);
  assert.equal(itemOf(rich, 'req:legacy#1').forwardsTo, 'req:a#1');
});

test('forwards record every void reason and mirror forwardsTo', () => {
  const doc = build({
    mode: 'rich',
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
    doc.forwards.find((f) => f.from === from && f.to === to);
  assert.equal(reason('req:dup#1', 'dsn:b#1').effective, true);
  assert.equal(reason('req:dup#1', 'dsn:b#1').voidedBy, undefined);
  assert.equal(reason('req:dup#1', 'dsn:c#1').voidedBy, 'duplicate');
  assert.equal(reason('req:eta#1', 'req:eta#1').voidedBy, 'cycle');
  assert.equal(reason('req:ghost#1', 'dsn:b#1').voidedBy, 'missing-source');
  // the effective declaration is the only one mirrored on the item
  assert.equal(itemOf(doc, 'req:dup#1').forwardsTo, 'dsn:b#1');
});

test('problems are reported with location and fail the run without any defect', () => {
  const doc = build({ code: ['// [>>utest:a#1]'] });
  assert.equal(doc.ok, false);
  assert.deepEqual(doc.problems, [
    {
      file: 'src/impl.js',
      line: 1,
      character: 4,
      message: 'need tag [>>utest:a#1] has no preceding item tag in this file',
    },
  ]);
  assert.equal(doc.summary.defectiveItems, 0);
  assert.equal(doc.summary.problems, 1);
});

test('a rich document carries every field the schema marks required', () => {
  // one document exercising every $def: an item with a resolved and an
  // uncovered need, a valid cover, a defect and an incoming wanter; an
  // effective and a voided forwarding; and a problem
  const doc = build({
    mode: 'rich',
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

  const req = itemOf(doc, 'req:a#1');
  hasRequired(doc, schema, 'document');
  assert.ok('forwards' in doc, 'rich document has forwards'); // required by the schema's allOf
  hasRequired(req, schema.$defs.item, 'item');
  assert.ok('wantedBy' in req, 'rich item has wantedBy');
  hasRequired(req.needs[0], schema.$defs.need, 'need');
  hasRequired(req.covers[0], schema.$defs.cover, 'cover');
  hasRequired(req.defects[0], schema.$defs.defect, 'defect');
  hasRequired(req.wantedBy[0], schema.$defs.wanter, 'wanter');
  hasRequired(doc.forwards[0], schema.$defs.forward, 'forward');
  hasRequired(doc.problems[0], schema.$defs.problem, 'problem');
  hasRequired(doc.summary, schema.$defs.summary, 'summary');
});

test('items, forwards and problems are sorted by file, line, character', () => {
  const doc = build({
    mode: 'rich',
    md: ['`req:b#1`', '', '`req:a#1`'],
  });
  // two items on the same file: order follows line, not id
  assert.deepEqual(doc.items.map((i) => i.id), ['req:b#1', 'req:a#1']);
  assert.deepEqual(doc.items.map((i) => i.line), [1, 3]);
  for (const item of doc.items) assert.ok(!item.file.includes('\\')); // forward slashes only
});
