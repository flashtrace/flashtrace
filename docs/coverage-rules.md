# Coverage rules

- A need `X` of item `A` is **covered** iff an item matching `X` exists. For a concrete revision that means an item whose ID is SemVer-equal to `X` - `impl:a#3.7` is matched by an item defined as `impl:a#3.7.0` (see [Revisions](revisions.md)); for a [wildcard revision](revisions.md#wildcard-revisions) (e.g. `impl:a#2.x`) it means at least one defined item whose ID matches the pattern.
- Item `A` is **shallow-covered** iff all of its needs are covered; **deep-covered** iff additionally every needed item is itself deep-covered (transitively, cycle-safe).
- A forwarding `[A --> B]` (see [Forwarding / delegation](forwarding.md)) redirects `A`'s obligation: `A` is shallow-covered iff `B` exists and deep-covered iff `B` is deep-covered; `A`'s own needs are not checked for coverage (but still validate incoming `Covers` entries).
- A `Covers: Y` entry on item `A` is **valid** iff item `Y` exists *and* `Y` lists `A`'s ID in its `Needs` (again matched SemVer-equal, or via a wildcard need).

## Defects

| Defect     | Meaning                                                                                     |
|------------|---------------------------------------------------------------------------------------------|
| uncovered  | A needed ID - or a forwarding target - does not exist. If the same `type:group/name` exists at another revision, the report flags the revision mismatch (outdated/predated reference). |
| orphaned   | A `Covers` entry points to a non-existent ID (with the same revision-mismatch hint).         |
| unwanted   | Coverage nobody asked for: a `Covers` entry whose target does not need the coverer's ID, or a code item whose ID is neither needed by any item nor a forwarding target. |
| duplicate  | The same ID - revisions compared SemVer-equal, so `#2.4` and `#2.4.0` collide - is defined more than once, or more than one forwarding is declared for the same source ID. |
| problem    | Parse-level error, e.g. a `[>>…]` tag with no preceding item tag, a malformed ID in a `Needs`/`Covers` list, a forwarding from a non-existent item, or a cyclic forwarding chain. |
