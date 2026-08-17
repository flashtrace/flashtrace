# Several needs of the same type

A `Needs` entry names one concrete item rather than an artifact type, so an
item may demand **as many items of one type as its work actually takes**, and
each of them is traced on its own. What tells those members apart is the
`[group/]` path of their IDs: one artifact kind stays one type and the set
grows along the name, instead of numbering the type vocabulary into `impl1`,
`impl2`.

This project traces an order API, where every route needs a route, a service
and a repository layer - a fixed set of layers that repeats per operation.

- [spec.md](spec.md) holds three Markdown items.
  - `feat:order#1` needs two items of type `req` - `req:order/create#1` and
    `req:order/cancel#1`. Multiplicity is not limited to code items.
  - `req:order/create#1` needs its three `impl` layers plus a `utest`, written
    as full IDs. The group path separates the layers:
    `impl:order/create/route#1`, `…/service#1`, `…/repository#1`.
  - `req:order/cancel#1` needs the same four, written **short** - the three
    `impl` entries take the revision from the requirement stating them, and
    the bare `utest` takes its `[group/]name` too, resolving to
    `utest:order/cancel#1`. It is the same list as above, one column narrower.
  - Both requirements answer the feature from the other side with
    `Covers: feat:order#1`. The entry is valid for each of them at once,
    because the feature names both in its `Needs`.
- [routes.ts](routes.ts), [service.ts](service.ts) and
  [repository.ts](repository.ts) hold the two operations' layers side by side,
  one file per layer - the same grouping the IDs spell out.
- [routes.ts](routes.ts) also shows the multiplicity **from the code side**: a
  code item attaches one need per tag, so the two `[>>…]` tags below
  `[impl:order/create/route#1]` demand the service and the repository it calls
  through. [service.ts](service.ts) does the same with a single tag.
- [order.spec.ts](order.spec.ts) provides the unit-test item each requirement
  needs.

Running flashtrace in this directory reports a clean trace and exits with code
0; with -v it prints each requirement's needs as a separate edge, so a missing
layer would be named individually rather than leaving the requirement merely
uncovered.
