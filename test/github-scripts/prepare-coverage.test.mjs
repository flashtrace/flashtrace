import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isOlderThan } from '../../.github/scripts/prepare-coverage.mjs';

const MINIMUM = [22, 5, 0];

test('isOlderThan refuses versions below the 22.5 floor', () => {
  for (const version of [[18, 20, 4], [20, 11, 0], [22, 4, 9], [22, 4, 999]]) {
    assert.equal(isOlderThan(version, MINIMUM), true, version.join('.'));
  }
});

test('isOlderThan admits the floor itself and everything above it', () => {
  for (const version of [[22, 5, 0], [22, 5, 1], [22, 11, 0], [23, 0, 0], [26, 4, 0]]) {
    assert.equal(isOlderThan(version, MINIMUM), false, version.join('.'));
  }
});

test('isOlderThan reads components left to right, not by their sum', () => {
  // A large patch cannot make up for a smaller minor.
  assert.equal(isOlderThan([22, 4, 100], MINIMUM), true);
  // A larger major wins however small the minor.
  assert.equal(isOlderThan([23, 0, 0], MINIMUM), false);
});
