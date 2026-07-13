# Proposal: impact analysis (`--impact <ref>`)

Status: **proposed** — not implemented. This document is a design proposal; it
becomes part of the spec ([docs/index.md](../index.md)) only once accepted and
implemented.

## Motivation

Revisions are flashtrace's core mechanic: matching is exact, so going from
`impl:auth/login#2.4` to `#2.5` is an intentional, breaking change — every
exact `Needs`, `Covers`, forwarding target and code tag that referenced `#2.4`
goes stale ([Revisions](../revisions.md)). Today the tool reports that damage
only *after* the bump, as `uncovered` / `orphaned` defects with a
revision-mismatch hint.

What's missing is the question every requirement-tracing workflow asks
*before* editing an item: **"if I change this, what is affected?"** — the
impact analysis that commercial requirements tools (DOORS "suspect links",
Polarion) treat as a first-class feature. flashtrace already holds the entire
trace graph in memory; it just never answers the reverse question.

This also complements, rather than overlaps, the open roadmap: JSON output
(#31) and the HTML report (#33/#30) change how results are *rendered*; impact
analysis adds a new *question* the analyzer can answer, and those renderers can
carry it later.

## CLI surface

```
flashtrace --impact <ref> [directory-or-file ...]
```

- `<ref>` is a full item ID (`impl:auth/login#2.4`) or a bare key without
  revision (`impl:auth/login`), which means "all defined revisions of this
  item" — the natural form when planning a bump.
- Scanning and `--tags` filtering work exactly as today; `--impact` replaces
  the coverage report with the impact report. Combining with `-v` is a usage
  error (exit 2) until a verbose variant is specified.
- An option rather than a subcommand keeps the CLI single-mode and the
  positional arguments unambiguous (they stay directories/files). If the
  shorthand-subcommand direction of #18 (`flashtrace everywhere`) lands first,
  `flashtrace impact <ref>` can become an alias.

Exit codes: `0` ref exists (impact printed, even if empty) · `1` ref matches
no defined item · `2` usage error. `--impact` never fails because of ordinary
coverage defects — it is a query, not a check.

## Semantics

An item `A` **directly depends on** item `X` when any of:

- `A` has a need (Markdown `Needs` or code `>>` tag) that `X` satisfies —
  exact ID or wildcard match, the same resolution `analyze` uses;
- `A` has a `Covers: X` entry;
- `A` forwards to `X` (`[A --> X]`).

The **impact set** of `<ref>` is every item from which a chain of such edges
reaches an item matching `<ref>` — i.e. the transitive closure of the reverse
edges, cycle-safe like `markDeepCoverage`.

Each direct edge is classified for the "what breaks on a bump" question:

- **exact** — the reference names the revision itself; removing/bumping the
  item makes this reference defective (`uncovered` / `orphaned` / broken
  forwarding).
- **tolerant** — a wildcard need (e.g. `impl:auth/login#2.x`) that *another
  existing revision* also satisfies; it survives the removal of this one.
- **wildcard-last** — a wildcard need for which the referenced item is the
  only match; formally a wildcard, but removal still breaks it (a same-pattern
  replacement revision would heal it).

Transitive members carry no classification of their own — they are listed
because a direct dependent sits on their coverage chain, mirroring how
shallow/deep coverage propagates.

## Report

One block per matched revision of `<ref>`, direct dependents first, then the
transitive tail, reusing the verbose report's visual language
([Command line](../command-line.md)):

```
impact of impl:auth/login#2.4  login.ts:3   (2 direct, 1 transitive)

  direct
    req:auth/login#1 "Login"  spec.md:12
        needs impl:auth/login#2.x (→ #2.4)   tolerant (also matched by #2.5)
    test:auth/login#3  login.test.ts:7
        covers impl:auth/login#2.4           exact — breaks on bump
  transitive
    req:auth#1 "Authentication"  spec.md:2   via req:auth/login#1
```

- No dependents: the block reads `no items depend on <id>` — for a code item
  that is precisely the existing `unwanted` condition, shown from the other
  side.
- Bare-key ref with no matches at all: `no item matches <key>` on stderr,
  exit 1, with the usual revision hint when other revisions of the key exist.
- Color/`NO_COLOR` behavior identical to the main report.

## Implementation sketch

- The reverse graph is derivable from existing pieces: `buildResolver`
  (`src/analyze.mjs`) plus the `wantedBy` map that `src/report.mjs` already
  builds for `-v` — extended with covers- and forwarding-edges. That map moves
  from the renderer into the analyzer (or a shared `src/graph.mjs`) so both
  consumers use one source of truth, the same argument that motivated
  `buildResolver`'s export.
- Traversal is a BFS over reverse edges with a visited set; classification of
  a direct edge is `isWildcardRev(revOf(need))` plus counting `matchesOf(n)`.
- `src/cli.mjs` gains the option, the mutual-exclusion check with `-v`, and
  the ref-syntax validation (reusing `src/ids.mjs`).
- Zero new dependencies, no changes to parsing or to any existing output.

Estimated effort: comparable to the verbose report (#27) — one focused PR.

## Non-goals (possible follow-ups)

- **Forward slice** (`what does X rest on?`) — the same machinery downward;
  kept out to keep the first PR one-directional.
- **`--impact` in JSON/HTML** — belongs to #31 / #33 once those define the
  envelope.
- **Auto-bump assistance** (rewriting stale references after a bump) — a
  write-mode feature with very different risk; impact analysis is its natural
  read-only precursor.

## Alternatives considered

- **Baseline/suppression file** for incremental adoption (fail only on *new*
  defects). Valuable, but its file format overlaps with the pending JSON
  output (#31) and is better designed after that lands.
- **Watch mode** (`--watch`). Convenient, but pure re-run ergonomics; adds no
  new answer the tool can't already give in a shell loop.
- **Config file**. Low value while the CLI has only two behavioral options.
