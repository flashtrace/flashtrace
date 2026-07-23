import { test } from 'node:test';
import assert from 'node:assert/strict';

import { KEYWORDS, applyKeyword } from '../src/spec-items.mjs';

const newItem = () => ({ id: 'spec/x', needs: [], covers: [], tags: [] });

// The seam guarded here: KEYWORDS is the vocabulary, but applyKeyword still
// spells out each keyword's behaviour. These must not drift - every keyword the
// vocabulary admits has to route somewhere, or a future addition would be
// filed silently under the wrong field.
test('applyKeyword handles every keyword in the vocabulary', () => {
  // empty entries exercise the dispatch without needing valid IDs: the branch
  // is chosen before any entry is read, so an unhandled keyword still throws.
  for (const keyword of KEYWORDS) {
    assert.doesNotThrow(
      () => applyKeyword(newItem(), keyword, [], 'f.md', [], 'test'),
      `keyword "${keyword}"`,
    );
  }
});

test('applyKeyword throws on a keyword it has no handling for', () => {
  // a word outside KEYWORDS must fail loudly, never fall through to Covers
  assert.throws(
    () => applyKeyword(newItem(), 'Blocks', [], 'f.md', [], 'test'),
    /no handling for keyword "Blocks"/,
  );
});

test('Tags entries are taken verbatim', () => {
  const item = newItem();
  const entry = { value: 'draft', line: 1, character: 1 };
  applyKeyword(item, 'Tags', [entry], 'f.md', [], 'test');
  assert.deepEqual(item.tags, ['draft']);
});

// A verbatim keyword shares applyKeyword's reference loop, so a value that
// looks like an invalid ID must still be stored, never reported as a problem.
test('Tags take a value verbatim without validating it as an ID', () => {
  const item = newItem();
  const problems = [];
  applyKeyword(item, 'Tags', [{ value: 'not an id', line: 1, character: 1 }], 'f.md', problems, 'test');
  assert.deepEqual(item.tags, ['not an id']);
  assert.deepEqual(problems, []);
});
