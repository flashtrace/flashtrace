import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deleteOrder, postOrder } from './routes';

// [utest:order/create#1]
test('placing an order returns its id', () => {
  assert.equal(postOrder({ item: 'book' }).id, 'order-book');
});

// [utest:order/cancel#1]
test('cancelling a stored order succeeds once', () => {
  postOrder({ item: 'lamp' });
  assert.equal(deleteOrder('order-lamp'), true);
  assert.equal(deleteOrder('order-lamp'), false);
});
