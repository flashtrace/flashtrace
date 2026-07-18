# Item IDs

Every traceable item has a project-wide unique ID:

```
<type>:[<group>/[<group>/…]]<name>#<revision>
```

- **type** - ASCII letters only (e.g. `feat`, `req`, `dsn`, `impl`, `utest`). Types are free-form; the tool does not hardcode a hierarchy.
- **group** - *optional* grouping path of one or more segments, each separated from the next segment (and from the name) by `/`. Groups may be nested arbitrarily deep; the tool treats the path as an opaque part of the ID.
- **name** - letters, digits, `_`, `-`, `.`; must start with a letter. The same rules apply to each group segment.
- **revision** - one to three dot-separated non-negative integers, semver-style: `X`, `X.Y` or `X.Y.Z`. No pre-release/build appendices, and at most three layers. Increment it whenever the item's meaning changes; this invalidates all references that still name the old revision. See [Revisions](revisions.md).

Examples: `req:auth/login#1`, `req:auth/session/login#1.2`, `impl:whatever-other-name#2.0.3`.

Matching is always by the **full ID** including the revision. Revisions compare as SemVer versions - omitted layers are zero, so `2.4` and `2.4.0` name the same revision. A reference can opt into a range with a [wildcard revision](revisions.md#wildcard-revisions).
