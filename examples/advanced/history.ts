// [impl:checkout/history#1]
export interface Order {
  id: string;
  placedAt: number;
}

export function history(orders: Order[]): Order[] {
  return [...orders].sort((a, b) => b.placedAt - a.placedAt);
}
