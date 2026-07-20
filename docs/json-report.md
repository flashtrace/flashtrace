# JSON report

`-f json`, or its shorthand `--json`, replaces the plain-text report on stdout with a single JSON document describing the run. Everything the plain-text report shows - items, defects, problems, summary, verdict - is contained in the document; nothing else is written to stdout. Exit codes are unchanged (see [Command line](command-line.md)).

The document is the complete run: every item, every forwarding declaration and every problem, whatever their status. Selecting a subset is the consumer's job, and `jq` does it in one filter - so the format takes no further options, and combining it with `-v`/`--verbose` is a usage error (exit code `2`): verbosity picks which items the plain-text report lists, and the document already carries them all. Usage errors are reported as plain text on stderr; a JSON document is only ever produced by a completed run.

Tag import filtering (`-t`, `--tags`) applies before analysis, exactly as for the plain-text report.

The document goes to stdout, never to a file; redirect it if you want one:

```sh
flashtrace -f json src > report.json
flashtrace --json src | jq .
```

## Schema

The structure of the document - every field, its type and its meaning - is defined by a JSON Schema (draft 2020-12). That schema is the contract; this page does not restate it. It is kept in the repository at `schemas/report/v1.json` and served at <https://flashtrace.github.io/schemas/report/v1.json>. Every schema version keeps its own URL; <https://flashtrace.github.io/schemas/report/latest.json> serves the newest one.

The schema deliberately leaves unknown fields unconstrained: validating a newer document against an older schema must not fail on additive fields.

## Versioning

The document carries the version of the format it follows, and the schema pins that version.

- It is bumped only by a breaking change: a field removed, renamed or re-typed, or a documented meaning changed. Each bump is published as a new schema under its own URL.
- Additive changes - a new optional field - do not bump it. Consumers must therefore ignore fields they do not know (tolerant reader).
- The document also carries the version of the flashtrace that produced it. That is provenance for debugging; consumers must not derive the format from it.

## Ordering and determinism

The same input processed by the same flashtrace version produces a byte-identical document. The schema cannot express that, so the guarantees are stated here:

- Every array is ordered deterministically: entries that carry a source location sort by it, entries that mirror a declaration keep declaration order.
- Object keys serialize in a fixed order.
- The document is UTF-8, two-space indented, free of ANSI escapes and ends with a single newline.
