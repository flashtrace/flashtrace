type Order = { id: string; item: string; shipped: boolean };

const orders = new Map<string, Order>();

// [impl:order/create/repository#1]
export function storeOrder(order: Order): { id: string } {
  orders.set(order.id, order);
  return { id: order.id };
}

// [impl:order/cancel/repository#1]
export function removeOrder(id: string): boolean {
  return orders.delete(id);
}
