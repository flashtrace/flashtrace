# Typst specification

A specification written in Typst (`.typ`) instead of Markdown, exercising
every construct the Typst grammar offers.

- [spec.typ](spec.typ) defines a feature and two requirements.
  - `feat:auth#1` is titled by a labeled `=` heading and collects its needs
    from the `Needs` column of a `#table(...)` with a `table.header`.
  - `req:auth/login#1` states its needs inline - each ID backticked, since a
    bare `#` would open Typst code mode and drop the revision from the
    compiled document - and covers the feature through a term list item
    (`/ Covers:`) whose `#`-free short form may stay bare.
  - `req:auth/logout#1` states its needs as a bullet list; a `//` comment
    line in the file is ignored, exactly as Typst renders it.
- [login.ts](login.ts) and [logout.ts](logout.ts) provide the implementation
  items, [auth.spec.ts](auth.spec.ts) the unit-test items.

Running flashtrace in this directory reports a clean trace and exits with
code 0; with -v it lists the feature's table-fed need edges next to the
requirements' inline and bullet ones.
