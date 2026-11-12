// [impl:checkout/payment#1]
const charged = new Set<string>();

export function charge(orderId: string): boolean {
  if (charged.has(orderId)) return false;
  charged.add(orderId);
  return true;
}
