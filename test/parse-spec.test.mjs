import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SPEC_EXT, specParserFor } from '../src/parse-spec.mjs';
import { parseMarkdown } from '../src/parse-markdown.mjs';
import { parseTypst } from '../src/parse-typst.mjs';
import { KEYWORDS, isKeyword } from '../src/spec-items.mjs';

// The dispatcher and the extension set are two views of one map, so they cannot
// drift: every spec extension resolves to a parser, and nothing else does.
test('specParserFor resolves spec extensions to their parser', () => {
  assert.equal(specParserFor('.md'), parseMarkdown);
  assert.equal(specParserFor('.markdown'), parseMarkdown);
  assert.equal(specParserFor('.typ'), parseTypst);
});

test('specParserFor returns null for non-spec extensions', () => {
  // a code extension is not a spec format; cli.mjs falls back to parseCode
  assert.equal(specParserFor('.js'), null);
  // an unknown extension is neither
  assert.equal(specParserFor('.txt'), null);
});

test('SPEC_EXT is exactly the set of dispatched extensions', () => {
  assert.deepEqual([...SPEC_EXT].sort(), ['.markdown', '.md', '.typ']);
  for (const ext of SPEC_EXT) assert.notEqual(specParserFor(ext), null);
});

// parse-markdown.mjs interpolates KEYWORDS into a regex alternation unescaped,
// so this invariant is what keeps that safe. If a future keyword needs a
// metacharacter, escape at the interpolation site rather than loosen this.
test('every keyword is a regex-safe bare word', () => {
  const METACHARACTER = /[\\^$.*+?()[\]{}|]/;
  for (const keyword of KEYWORDS) {
    assert.equal(METACHARACTER.test(keyword), false, `keyword "${keyword}"`);
    assert.equal(isKeyword(keyword), true);
  }
});
