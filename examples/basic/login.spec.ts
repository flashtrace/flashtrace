// [utest:auth/login#1]
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { login } from './login';

test('accepts a token and rejects an empty one', () => {
  assert.equal(login('session-token'), true);
  assert.equal(login(''), false);
});
