# Item IDs

Every traceable item has a project-wide unique ID:

```
<type>:[<group>/[<group>/…]]<name>#<revision>
```

- **type** — ASCII letters only (e.g. `feat`, `req`, `dsn`, `impl`, `utest`). Types are free-form; the tool does not hardcode a hierarchy.
- **group** — *optional* grouping path of one or more segments, each separated from the next segment (and from the name) by `/`. Groups may be nested arbitrarily deep; the tool treats the path as an opaque part of the ID.
- **name** — letters, digits, `_`, `-`, `.`; must start with a letter. The same rules apply to each group segment.
- **revision** — non-negative integer. Increment it whenever the item's meaning changes; this invalidates all references that still name the old revision.

Examples: `req:auth/login#1`, `req:auth/session/login#1`, `impl:whatever-other-name#2`.

Matching is always by the **exact, full ID** including the revision.
