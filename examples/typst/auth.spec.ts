import { test } from 'node:test';
import assert from 'node:assert/strict';

import { login } from './login';
import { isRevoked, logout } from './logout';

// [utest:auth/login#1]
test('accepts a token and rejects an empty one', () => {
  assert.equal(login('session-token'), true);
  assert.equal(login(''), false);
});

// [utest:auth/logout#1]
test('a logged-out token is revoked', () => {
  logout('session-token');
  assert.equal(isRevoked('session-token'), true);
  assert.equal(isRevoked('other-token'), false);
});
