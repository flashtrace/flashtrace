// [utest:checkout/cart#1]
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cartTotal } from './cart';

test('sums price times quantity over every line item', () => {
  assert.equal(cartTotal([]), 0);
  assert.equal(cartTotal([{ price: 3, quantity: 2 }, { price: 4, quantity: 1 }]), 10);
});
