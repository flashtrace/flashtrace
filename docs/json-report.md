# JSON report

`--json[=<mode>]` replaces the plain-text report on stdout with a single JSON document describing the run. Everything the plain-text report shows - items, defects, problems, summary, verdict - is contained in the document; nothing else is written to stdout. Exit codes are unchanged (see [Command line](command-line.md)).

Two modes select the amount of detail:

| Mode | Content |
|---|---|
| `base` (default) | every item with its declared references, their resolution and its defects, plus all problems and the summary |
| `rich` | a strict superset of `base`: additionally the top-level `forwards` array and a `wantedBy` array on every item |

`--json` is shorthand for `--json=base`. Any other mode value is a usage error (exit code `2`), as is combining `--json` with `-v`/`--verbose` - JSON detail is selected by mode, not by verbosity. Usage errors are reported as plain text on stderr; a JSON document is only ever produced by a completed run.

Because `rich` only adds fields and never changes the shape or meaning of anything in `base`, a consumer written against `base` reads `rich` output unchanged.

## Document

```json
{
  "schemaVersion": 1,
  "flashtrace": "0.9.1",
  "mode": "base",
  "ok": false,
  "items": [],
  "problems": [],
  "summary": {}
}
```

| Field | Mode | Meaning |
|---|---|---|
| `schemaVersion` | both | Integer version of this format; see [Versioning](#versioning). |
| `flashtrace` | both | Version of the flashtrace that produced the document. Provenance only - consumers must not derive the format from it. |
| `mode` | both | `base` or `rich` - the mode that produced the document. |
| `ok` | both | The run verdict: `true` iff no item is defective and no problem occurred. Matches the plain-text `ok` / `not ok` footer and the exit code (`0` iff `true`). |
| `items` | both | Every item, regardless of status; see [Items](#items). |
| `forwards` | rich | Every forwarding declaration; see [Forwards](#forwards-rich-mode). |
| `problems` | both | Parse- and analysis-level problems; see [Problems](#problems). |
| `summary` | both | The summary counts; see [Summary](#summary). |

## Items

One entry per defined item. The document always contains *all* items, also in `base` mode - the defective-only filtering of the plain-text default report is presentation, not data; consumers filter on `status` themselves. Tag import filtering (`-t, --tags`) applies before analysis, exactly as for the plain-text report.

```json
{
  "id": "req:login#1",
  "title": "Login",
  "origin": "markdown",
  "tags": ["security"],
  "file": "docs/spec.md",
  "line": 12,
  "character": 1,
  "status": "defective",
  "needs": [
    { "ref": "impl:auth#2.x", "resolvedTo": ["impl:auth#2.1"] },
    { "ref": "dsn:flow#1", "resolvedTo": [] }
  ],
  "covers": [],
  "forwardsTo": null,
  "defects": [
    {
      "kind": "uncovered",
      "ref": "dsn:flow#1",
      "existingRevisions": ["2"],
      "message": "uncovered: needs dsn:flow#1, which does not exist (revision mismatch: existing revision(s) of dsn:flow: 2)"
    }
  ]
}
```

| Field | Mode | Meaning |
|---|---|---|
| `id` | both | The item's full ID. Not unique on its own - a *duplicate* defect means several entries share it; `id` + `file` + `line` + `character` is unique (see [Locations](#locations)). |
| `title` | both | The heading above a Markdown item, or `null` if there is none. Always `null` for code items. |
| `origin` | both | `markdown` or `code`. |
| `tags` | both | The item's `Tags` entries. Always `[]` for code items. |
| `file`, `line`, `character` | both | Source location of the defining ID/tag; see [Locations](#locations). |
| `status` | both | `defective` (at least one defect), `shallow-covered` (no defects, but not deep-covered) or `deep-covered` - the three states the summary and the verbose plain-text report distinguish, per the [Coverage rules](coverage-rules.md). |
| `needs` | both | One entry per declared `Needs` reference, in declaration order; see below. |
| `covers` | both | One entry per declared `Covers` reference, in declaration order; see below. |
| `forwardsTo` | both | The ID of the effective forwarding target, or `null`. Voided declarations (duplicate, cyclic, missing source) never appear here - they surface as defects/problems and, in `rich` mode, in `forwards`. |
| `defects` | both | The item's defects; see below. Empty iff the item is not defective. |
| `wantedBy` | rich | The items whose needs this item satisfies; see below. |

### Needs entries

`ref` is the reference exactly as declared; `resolvedTo` lists the full IDs of the defined items matching it, in ascending revision order. A concrete reference resolves to at most one ID; a [wildcard revision](revisions.md#wildcard-revisions) to any number. A need is **covered** exactly when `resolvedTo` is non-empty - there is no separate flag.

A forwarding source keeps its literal needs list, resolution included: the needs are excused from its coverage obligation (which follows `forwardsTo`), so an unresolved need raises no *uncovered* defect there, but they still validate incoming `Covers` entries - see [Forwarding / delegation](forwarding.md).

### Covers entries

`{ "ref": "req:base#1", "status": "valid" }` - `ref` is the (always concrete) ID as declared, `status` classifies the relation per the [Coverage rules](coverage-rules.md):

- `valid` - the target exists and needs this item's ID
- `orphaned` - the target does not exist
- `unwanted` - the target exists but does not need this item's ID

A non-`valid` covers entry additionally appears as the matching `orphaned` / `unwanted` defect on the same item.

### Defects

- `kind` - `uncovered`, `orphaned`, `unwanted` or `duplicate`, per the [Coverage rules](coverage-rules.md)
- `ref` - the ID the defect is about: the needed, covered or forwarded-to ID; for `duplicate`, the duplicated item ID or forwarding source ID
- `message` - the defect exactly as the plain-text report words it
- `existingRevisions` - present exactly when the revision-mismatch hint applies: the defined revisions of the same `type:group/name`, bare (without `#`), in ascending order

### wantedBy entries (rich mode)

One entry `{ "id": "req:login#1", "file": "docs/spec.md", "line": 12, "character": 1 }` per item whose needs resolve to this item, wildcard needs included; empty if nothing needs it. Forwarding demand is not listed here - it is visible in `forwards`.

## Forwards (rich mode)

One entry per forwarding declaration found in the sources - including voided declarations and declarations whose source item does not exist, which have no item to carry a `forwardsTo`:

```json
{ "from": "req:legacy#1", "to": "req:login#1", "file": "docs/spec.md", "line": 32, "character": 1, "effective": true }
```

| Field | Meaning |
|---|---|
| `from`, `to` | Source and target ID as declared. |
| `file`, `line`, `character` | Location of the declaration; see [Locations](#locations). |
| `effective` | `true` iff the declaration is in effect. The `forwardsTo` fields of the items mirror exactly the effective entries. |
| `voidedBy` | Present iff `effective` is `false`: `duplicate` (a later declaration for an already-forwarded source), `cycle` (the declaration sits on a cyclic chain) or `missing-source` (the source item does not exist). See [Forwarding / delegation](forwarding.md). |

```json
{ "from": "req:a#1", "to": "req:b#1", "file": "docs/a.md", "line": 5, "character": 1, "effective": false, "voidedBy": "cycle" }
```

## Problems

The same problems the plain-text report lists, one entry each:

```json
{
  "file": "src/session.js",
  "line": 2,
  "character": 4,
  "message": "need tag [>>test:auth#1] has no preceding item tag in this file"
}
```

Any problem makes the run fail, exactly as for the plain-text report (see [Command line](command-line.md)).

## Summary

```json
{
  "items": 4,
  "markdownItems": 3,
  "codeItems": 1,
  "okItems": 3,
  "defectiveItems": 1,
  "shallowCoveredItems": 1,
  "problems": 1
}
```

| Field | Meaning |
|---|---|
| `items` | Total number of items; `markdownItems + codeItems`. |
| `markdownItems`, `codeItems` | Items per origin. |
| `okItems` | Items without defects; `items - defectiveItems`. |
| `defectiveItems` | Items with at least one defect. |
| `shallowCoveredItems` | Ok items that are not deep-covered (an item further down the tracing chain is defective); at most `okItems`. |
| `problems` | Number of entries in the top-level `problems` array. |

## Locations

- `file` - path relative to the working directory, with forward slashes on every platform.
- `line` - 1-based source line.
- `character` - 1-based column of the first character of the construct the entry refers to: the `[` of a code tag, the first non-blank character of a Markdown item's ID line or of a Markdown forwarding line.

`id` + `file` + `line` + `character` is unique across `items`: one construct defines at most one item.

## Ordering and determinism

The same input processed by the same flashtrace version produces a byte-identical document:

- `items`, `forwards` and `problems` are sorted by `file`, then `line`, then `character`.
- `needs` and `covers` keep declaration order; `resolvedTo` is in ascending revision order; `wantedBy` is sorted by `file`, `line`, `character`.
- Object keys serialize in the order documented on this page.
- The document is UTF-8, two-space indented, free of ANSI escapes and ends with a single newline.

## Versioning

- `schemaVersion` is an integer owned by this page. It is bumped only by a breaking change: a field removed, renamed or re-typed, or a documented meaning changed.
- Additive changes - a new optional field, a new `mode` value - do not bump it. Consumers must therefore ignore fields they do not know (tolerant reader).
- `flashtrace` carries the producing tool version for provenance and debugging; it says nothing about the format.

## Schema

The machine-readable contract is a JSON Schema (draft 2020-12) covering both modes. It is published at <https://flashtrace.github.io/schemas/report/v1.json> and kept in the repository at `schemas/report/v1.json`. Every `schemaVersion` keeps its own URL; <https://flashtrace.github.io/schemas/report/latest.json> serves the newest one.

The schema deliberately leaves unknown fields unconstrained: validating a newer document against an older schema must not fail on additive fields.
