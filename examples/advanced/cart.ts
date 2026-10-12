// [impl:checkout/cart#1]
export interface LineItem {
  price: number;
  quantity: number;
}

export function cartTotal(items: LineItem[]): number {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}
