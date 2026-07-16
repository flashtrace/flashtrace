// [utest:session/store#1.2]
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { persist, restore } from '../store';

test('persists and restores a session', () => {
  persist('probe', '{}');
  assert.equal(restore('probe'), '{}');
});
