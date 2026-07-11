import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analyze } from '../src/analyze.mjs';
import { parseMarkdown } from '../src/parse-markdown.mjs';
import { parseCode } from '../src/parse-code.mjs';
import { buildReportModel } from '../src/report-model.mjs';
import { renderHtml } from '../src/report-html.mjs';

// Builds a model through the real parsers so the shapes always match.
function modelOf({ md = [], code = [] }) {
  const problems = [];
  const forwards = [];
  const items = [
    ...parseMarkdown('/proj/spec.md', md.join('\n'), problems, forwards),
    ...parseCode('/proj/src.ts', code.join('\n'), problems, forwards),
  ];
  analyze(items, forwards, problems);
  return buildReportModel(items, problems, '/proj');
}

const META = { version: '1.2.3', scannedPaths: ['.'], tags: null };

// the embedded JSON block, decoded the way the page's script decodes it
function embeddedData(html) {
  const m = html.match(/<script type="application\/json" id="data">(.*?)<\/script>/s);
  assert.ok(m, 'data block present');
  return JSON.parse(m[1]);
}

test('the HTML embeds the model with item ids and statuses', () => {
  const html = renderHtml(
    modelOf({ md: ['`req:a#1`', '', 'Needs: impl:a#1, impl:gone#1'], code: ['// [impl:a#1]'] }),
    META,
  );
  const { model, meta } = embeddedData(html);
  const ids = model.items.map((it) => it.id);
  assert.deepEqual(ids, ['req:a#1', 'impl:a#1']);
  assert.equal(model.items[0].status, 'defective');
  assert.equal(model.items[1].status, 'deep-covered');
  assert.equal(meta.version, '1.2.3');
});

test('the page carries both tab labels and no external requests', () => {
  const html = renderHtml(modelOf({ md: ['`req:a#1`'] }), META);
  assert.ok(html.includes('Show problems'));
  assert.ok(html.includes('Show all (verbose)'));
  assert.ok(!/\b(?:src|href)\s*=\s*["']https?:/i.test(html), 'no external URLs');
});

test('a title containing markup survives escaped in the JSON block', () => {
  const md = ['# a </script><b> title', '', '`req:a#1`'];
  const html = renderHtml(modelOf({ md }), META);
  // the raw sequence may not appear anywhere in the data block: every "<" is
  // emitted as its JSON unicode escape
  const block = html.slice(html.indexOf('id="data">') + 'id="data">'.length);
  const end = block.indexOf('</script>');
  assert.ok(!block.slice(0, end).includes('<'), 'no raw "<" inside the JSON block');
  assert.equal(embeddedData(html).model.items[0].title, 'a </script><b> title');
});

test('rendering is deterministic', () => {
  const fixture = { md: ['`req:a#1`', '', 'Needs: impl:a#1'], code: ['// [impl:a#1]'] };
  assert.equal(renderHtml(modelOf(fixture), META), renderHtml(modelOf(fixture), META));
});
