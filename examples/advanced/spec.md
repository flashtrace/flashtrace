# Checkout feature

`feat:checkout#1`

Customers turn the contents of their cart into a placed order.

Needs: req:checkout/cart#1, req:checkout/payment#1
Tags: shop
Needs:
- req:checkout/receipt#1
- req:checkout/history#1

# Cart totals
`req:checkout/cart#1`
The cart shows the sum of its line items.
Covers:
- feat:checkout#1
Needs:
- impl:checkout/cart#1
- utest:checkout/cart#1
Tags:
- shop
- pricing

# Single charge

`req:checkout/payment#1`

Description: A placed order is charged exactly once.
Covers: feat:checkout#1
Needs: impl:checkout/payment#1

# Receipt

`req:checkout/receipt#1`

Tags: shop
Covers: feat:checkout#1
Description:
Every placed order produces a receipt
that lists its line items and its total.

# Order history

`req:checkout/history#1`

Description: Customers can list their past orders,
newest first.

Informative text: the history is read-only, so it needs no test of its own.

| Needs                   | Covers          | Tags    | Owner |
|-------------------------|-----------------|---------|-------|
| impl:checkout/history#1 | feat:checkout#1 | shop    | Alice |
|                         |                 | history | Bob   |
