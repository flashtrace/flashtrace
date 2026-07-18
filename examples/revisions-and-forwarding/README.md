# Revisions and forwarding

Demonstrates SemVer revision matching, wildcard needs and a forwarding
chain, all in a clean trace (exit code 0).

- Omitted revision layers are zero, as SemVer defines: the feature in
  [spec.md](spec.md) demands the store requirement as 2.4, which names the
  same revision as the defined 2.4.0.
- A wildcard need accepts any revision under its numeric layers: the store
  requirement's need impl:session/store#2.x resolves to the 2.4.1 defined in
  [store.ts](store.ts), and utest:session/store#1.* - `*` is an alias for
  `x` - to the 1.2 in [tests/store.spec.ts](tests/store.spec.ts).
- A two-link forwarding chain hands the API requirement's coverage obligation
  to the design item, which forwards it on to the implementation in
  [api.ts](api.ts). The requirement counts as covered because the end of the
  chain is.
