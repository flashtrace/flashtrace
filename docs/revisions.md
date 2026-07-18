# Revisions

The `#<revision>` suffix of an [item ID](item-ids.md) is a semver-style version:

```
X | X.Y | X.Y.Z
```

- One to three dot-separated non-negative integers.
- Every layer is optional *from the right*: `2`, `2.3` and `2.3.5` are all valid.
- No pre-release or build appendices - `1.0.0-rc.1` and `1.0.0+build` are **not** revisions.
- At most three layers; `1.2.3.4` is not a revision.

## Matching is SemVer matching

Omitted layers are zero, as SemVer defines. Every revision therefore has a
canonical three-layer form, and two revisions name the **same** revision
exactly when their canonical forms are equal:

- `2.4` = `2.4.0` (canonical form `2.4.0`)
- `2` = `2.0` = `2.0.0`
- `2.4` ≠ `2.4.1`, `2.4.2`, …

This identity applies everywhere revisions are compared: `Needs` and `Covers`
entries, forwarding sources and targets, and duplicate detection - defining
`req:a#2.4` next to `req:a#2.4.0` defines the same ID twice.

## Wildcard revisions

When you genuinely want "any downstream revision", opt in explicitly with a
wildcard. A wildcard revision is zero to two leading numeric layers followed
by a single trailing wildcard layer, written `x` or its alias `*`:

| Pattern | Matches | Does **not** match |
|---|---|---|
| `x` = `*` | every revision: `2`, `4.1`, `3.0.9`, … | – |
| `2.x` = `2.*` | `2`, `2.4`, `2.4.1`, `2.99` | `3`, `1.9.5` |
| `2.3.x` = `2.3.*` | `2.3`, `2.3.0`, `2.3.7` | `2.4.0` |

The wildcard layer stands for its own layer *and every deeper one*, so `2.x`
reads as "anything within revision 2"; the leading numeric layers match
SemVer-normalized like everywhere else. A wildcard is only valid as the last
layer: `2.x.y`, `x.y` and `x.2` are not revisions.

Wildcards may be used only where a revision is *demanded*:

- Markdown `Needs:` entries
- the target of a code need tag - `[>>utest:a#2.x]` or `[impl:a#1 >> utest:a#2.x]`

Item definitions, `Covers:` entries and [forwarding](forwarding.md) tags must
name a concrete revision.
