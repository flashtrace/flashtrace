# Short-form needs and covers

Every `Needs` and `Covers` reference here is written **short**: it names only
what sets it apart and lets flashtrace fill in the rest - the `[group/]name`,
the `#<revision>`, or both - from the item stating it. The same short form
works in a code `[>>…]` need tag, completed from the item tag above it.

- [spec.md](spec.md) holds two Markdown items.
  - `feat:auth/login#1` has `Needs: req`. The bare type completes to the
    feature's own name and revision - `req:auth/login#1`.
  - `req:auth/login#1` has `Covers: feat` - the same both-dropped form
    resolving to `feat:auth/login#1`, answering the feature's need from the
    other side. Its `Needs` list pairs `impl` (name and revision taken -
    `impl:auth/login#1`) with `utest#1` (name taken, revision stated -
    `utest:auth/login#1`).
- [login.ts](login.ts) defines `impl:auth/login#1` and, right below it, the
  need tag `[>>impl:auth/session]`. The short target keeps its stated name and
  takes the revision from the tag above, demanding `impl:auth/session#1` from
  [session.ts](session.ts).
- [login.spec.ts](login.spec.ts) provides the unit-test item the requirement
  needs.

Running flashtrace in this directory reports a clean trace and exits with
code 0; with -v it prints each edge with its short form already resolved to a
full ID, including the matched `covers`/`wanted by` pair between the feature
and the requirement.
