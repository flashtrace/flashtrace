# Coverage rules

- A need `X` of item `A` is **covered** iff an item with the exact ID `X` exists.
- Item `A` is **shallow-covered** iff all of its needs are covered; **deep-covered** iff additionally every needed item is itself deep-covered (transitively, cycle-safe).
- A forwarding `[A --> B]` (see [Forwarding / delegation](forwarding.md)) redirects `A`'s obligation: `A` is shallow-covered iff `B` exists and deep-covered iff `B` is deep-covered; `A`'s own needs are not checked for coverage (but still validate incoming `Covers` entries).
- A `Covers: Y` entry on item `A` is **valid** iff item `Y` exists *and* `Y` lists `A`'s exact ID in its `Needs`.

## Defects

| Defect     | Meaning                                                                                     |
|------------|---------------------------------------------------------------------------------------------|
| uncovered  | A needed ID - or a forwarding target - does not exist. If the same `type:group/name` exists at another revision, the report flags the revision mismatch (outdated/predated reference). |
| orphaned   | A `Covers` entry points to a non-existent ID (with the same revision-mismatch hint).         |
| unwanted   | Coverage nobody asked for: a `Covers` entry whose target does not need the coverer's ID, or a code item whose ID is neither needed by any item nor a forwarding target. |
| duplicate  | The same full ID is defined more than once, or more than one forwarding is declared for the same source ID. |
| problem    | Parse-level error, e.g. a `[>>…]` tag with no preceding item tag, a malformed ID in a `Needs`/`Covers` list, or a forwarding from a non-existent item. |
