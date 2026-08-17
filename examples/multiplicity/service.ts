import { removeOrder, storeOrder } from './repository';

// [impl:order/create/service#1]
export function createOrder(item: string): { id: string } {
  return storeOrder({ id: `order-${item}`, item, shipped: false });
}

// [impl:order/cancel/service#1]
// [>>impl:order/cancel/repository#1]
export function cancelOrder(id: string): boolean {
  return removeOrder(id);
}
