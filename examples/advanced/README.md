# Every keyword in every form

Each Markdown keyword - `Needs`, `Covers`, `Tags` and `Description` - appears
here in every form flashtrace accepts. The rest stays simple: single
revisions, one item tag per code file, no forwarding and no code needs.

- [spec.md](spec.md) holds five Markdown items.
  - `feat:checkout#1` has its description under the ID, after a blank line.
    `Needs` appears twice - inline and then as a bullet list - and both
    merge into one list of four needs. `Tags` sits inline between them.
  - `req:checkout/cart#1` has its description directly under the ID, with no
    blank line; the `Covers` keyword line right below ends it. `Covers`,
    `Needs` and `Tags` are bullet lists.
  - `req:checkout/payment#1` states its description with the `Description`
    keyword as the first line under the ID; the `Covers` line right below
    ends it.
  - `req:checkout/receipt#1` opens with `Tags` and `Covers`, so no
    description sits under its ID; a bare `Description:` further down
    starts the description on the line below and runs over two lines. It
    needs nothing, so it ends its tracing chain.
  - `req:checkout/history#1` writes its `Description` text over two lines,
    ended by a blank line; the paragraph after that is informative. Its
    `Needs`, `Covers` and `Tags` come from a keyword table, whose `Owner`
    column is ignored and whose empty cells are skipped.
- [cart.ts](cart.ts), [cart.test.ts](cart.test.ts), [payment.ts](payment.ts)
  and [history.ts](history.ts) provide the code items the requirements need.

Running flashtrace in this directory reports a clean trace and exits with
code 0: neither description form is reported. The tags read from every form
show in the `--json` report. A description stated twice is a problem; the
[diagnostics](../diagnostics/) gallery shows both cases.
