# Revisions and forwarding

Demonstrates exact multi-layer revisions, wildcard needs and a forwarding
chain, all in a clean trace (exit code 0).

- Layer counts are part of an item's identity: the feature in
  [spec.md](spec.md) demands the store requirement at exactly revision 2.4.0,
  and a reference to 2.4 would name a different revision.
- Wildcard needs accept any revision with the same layer count: the store
  requirement's need impl:session/store#2.x.y resolves to the 2.4.1 defined in
  [store.ts](store.ts), and utest:session/store#1.x to the 1.2 in
  [tests/store.spec.ts](tests/store.spec.ts).
- A two-link forwarding chain hands the API requirement's coverage obligation
  to the design item, which forwards it on to the implementation in
  [api.ts](api.ts). The requirement counts as covered because the end of the
  chain is.
