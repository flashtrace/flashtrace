# Revisions

The `#<revision>` suffix of an [item ID](item-ids.md) is a semver-style version:

```
X | X.Y | X.Y.Z
```

- One to three dot-separated non-negative integers.
- Every layer is optional *from the right*: `2`, `2.3` and `2.3.5` are all valid.
- No pre-release or build appendices - `1.0.0-rc.1` and `1.0.0+build` are **not** revisions.
- At most three layers; `1.2.3.4` is not a revision.

## Matching is exact

The layers are part of the item's identity, so matching stays exact including
the number of layers. Dropping a layer yields a **different** revision, not a
looser one:

- `2.4` ≠ `2.4.0`
- `2.4` ≠ `2.4.1`, `2.4.2`, …

Going from `2.3.5` to `2.4` is therefore an intentional, self-contained bump:
`2.4` is its own revision and never silently resolves to some `2.4.z`.

## Wildcard revisions

When you genuinely want "any downstream revision", opt in explicitly with a
wildcard. A wildcard revision is zero or more leading numeric layers followed by
wildcard layers named `x`, `y`, `z` in order, capped at three layers total:

| Pattern | Matches | Does **not** match |
|---|---|---|
| `2.x` | `2.0`, `2.4`, `2.99` | `2` · `2.4.0` (different layer count) |
| `2.3.x` | `2.3.0`, `2.3.7` | `2.3` · `2.4.0` |
| `2.x.y` | `2.0.0`, `2.9.4` | `2.4` |

A wildcard only ever matches concrete revisions with the **same layer count**,
so it keeps plain revisions unambiguous while giving a clear range when you ask
for one.

Wildcards may be used only where a revision is *demanded*:

- Markdown `Needs:` entries
- the target of a code need tag - `[>>utest:a#2.x]` or `[impl:a#1 >> utest:a#2.x]`

Item definitions, `Covers:` entries and [forwarding](forwarding.md) tags must
name a concrete revision.
