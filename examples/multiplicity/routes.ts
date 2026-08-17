import { cancelOrder, createOrder } from './service';

// [impl:order/create/route#1]
// [>>impl:order/create/service#1]
// [>>impl:order/create/repository#1]
export function postOrder(body: { item: string }): { id: string } {
  return createOrder(body.item);
}

// [impl:order/cancel/route#1]
export function deleteOrder(id: string): boolean {
  return cancelOrder(id);
}
