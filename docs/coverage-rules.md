# Coverage rules

- A need `X` of item `A` is **covered** iff an item with the exact ID `X` exists.
- Item `A` is **shallow-covered** iff all of its needs are covered; **deep-covered** iff additionally every needed item is itself deep-covered (transitively, cycle-safe).
- A `Covers: Y` entry on item `A` is **valid** iff item `Y` exists *and* `Y` lists `A`'s exact ID in its `Needs`.

## Defects

| Defect     | Meaning                                                                                     |
|------------|---------------------------------------------------------------------------------------------|
| uncovered  | A needed ID does not exist. If the same `type:group/name` exists at another revision, the report flags the revision mismatch (outdated/predated reference). |
| orphaned   | A `Covers` entry points to a non-existent ID (with the same revision-mismatch hint).         |
| unwanted   | Coverage nobody asked for: a `Covers` entry whose target does not need the coverer's ID, or a code item whose ID is not needed by any item. |
| duplicate  | The same full ID is defined more than once.                                                  |
| problem    | Parse-level error, e.g. a `[>>…]` tag with no preceding item tag, or a malformed ID in a `Needs`/`Covers` list. |
