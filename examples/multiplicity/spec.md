# Order API

`feat:order#1`

Clients manage their orders through the HTTP API.

Needs: req:order/create#1, req:order/cancel#1

# Creating an order

`req:order/create#1`

A client can place an order; it is persisted before the call returns.

Covers: feat:order#1
Needs: impl:order/create/route#1, impl:order/create/service#1, impl:order/create/repository#1, utest:order/create#1

# Cancelling an order

`req:order/cancel#1`

A client can cancel an order that has not shipped yet.

Covers: feat:order#1
Needs:
- impl:order/cancel/route
- impl:order/cancel/service
- impl:order/cancel/repository
- utest
