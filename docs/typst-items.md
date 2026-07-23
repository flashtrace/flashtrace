# Typst items (`.typ`)

An item is defined by a line that contains nothing but its ID in backticks - a Typst raw span, so the ID renders verbatim and the `#` of the revision stays literal instead of opening Typst code mode:

```typst
== Login requires a valid session token
`req:auth/login#1`

The system only accepts requests that carry a valid session token.
A second line still belongs to the description.

Everything after the blank line above is informative and ignored.

Needs: `impl:auth/login#1`, `utest:auth/login#1`

/ Covers:
- `feat:auth#1`

Tags: Auth, Security
```

- **Title** - the heading directly above the ID line, written `= Title` with any number of `=` (Typst does not cap heading levels; indentation before the `=` run is allowed). Only blank lines may sit between the heading and the ID; if any other text does, the item has *no* title. A trailing `<label>` on the heading attaches a Typst label and is dropped from the title. Markdown's setext form (a paragraph above a `===`/`---` underline) is not a heading in Typst and titles nothing.
- **Description** - the lines following the ID. A single blank line directly under the ID (before the description starts) is permitted. The description ends at the next blank line; everything after that is treated as informative text and skipped.
- **Keywords** - after the description, an item may carry:
  - `Needs:` - the items required to cover this one. Because needs are explicit references, multiple needed items of the same type are possible. A need may use a [wildcard revision](revisions.md#wildcard-revisions) (e.g. `` `impl:auth/login#2.x` ``) to accept any matching downstream revision. A need may also be written **short**, dropping whatever the item stating it already fixes: the `[group/[group/]]name`, the `#<revision>`, or both are then taken from that item. Inside `req:auth/login#1`, the full ID `` `impl:auth/login#1` `` may be shortened to `` `impl#1` `` (name taken), `impl:auth/login` (revision taken), or just `impl` (both taken).
  - `Covers:` - the items this item covers, at concrete revisions only. A `Covers` entry accepts the same short form as `Needs`, completed from this item's own `[group/]name` and revision; a wildcard revision stays rejected here.
  - `Tags:` - free-form tag names for additional grouping/filtering.

  A keyword line may also be written as a Typst term list item (`/ Needs: ...`), the idiomatic spelling of a labeled field. Each keyword accepts a one-line comma-separated list, a list on the immediately following lines (`-` bullet items or `+` enumeration items; `*` spells strong emphasis in Typst and is no list marker), or a `#table(...)` column (see below). The inline and list styles must not be mixed within one keyword.

## IDs carrying a revision must be backticked

In Typst markup a bare `#` opens code mode: `impl:auth/login#1` written without backticks compiles to *impl:auth/login1* - the revision silently vanishes from the rendered document. The tracer therefore accepts a `Needs`/`Covers` entry spelled with a `#` only inside backticks and reports the bare spelling as a problem at the entry, instead of tracing an ID the compiled document does not show. Short forms without a `#` (`impl`, `impl:other`) render verbatim and may stay bare.

## Comments and raw blocks

Typst reads `//` line comments and nestable block comments even in markup mode, and a fenced raw block (three or more backticks) displays its content verbatim. The tracer agrees with the rendered document:

- a commented-out ID line, keyword line, or forwarding tag contributes nothing;
- a trailing comment (`` `req:auth/login#1` // reviewed ``) leaves the construct intact;
- inside a raw block, IDs and keywords are display material and are not traced;
- inside a single-backtick raw span, comment markers are literal text;
- the `//` of a URL (`https://...`) is link text, never a comment - as in [code tags](code-tags.md).

## Keyword entries from tables

Typst has no pipe tables; the equivalent of a Markdown keyword table column is a column of the `#table(...)` function. A column headed by a bare keyword name (`Needs`, `Covers`, or `Tags` - no colon) contributes each row's cell in that column as one entry:

```typst
#table(
  columns: 3,
  table.header([Feature], [Needs], [Owner]),
  [Login], [`impl:auth/login#1`], [Alice],
  [Logout], [`impl:auth/logout#1`], [Bob],
)
```

- The call must open its line (indentation allowed): a line starting `#table(`, through the matching closing paren.
- The column count comes from the `columns:` argument, given as an integer or a parenthesized track list (`(auto, 1fr, auto)` counts three). Without the argument, the `table.header(...)` cell count rules.
- The header row is `table.header(...)`'s cells when present, else the first row of plain cells.
- The keyword column may sit at any position, and one table may combine several keyword columns. All other columns are ignored by the tracer.
- A cell holds at most one entry; empty cells are skipped. Multiple entries simply mean multiple rows.
- A table whose header contains no keyword cell is ordinary informative material - it is never part of a description.
- Named arguments (`fill:`, `align:`, `stroke:`, ...) and the line decorations `table.hline(...)` / `table.vline(...)` are skipped; `table.footer(...)` is ignored.
- A `table.cell(...)` call - or any other call in cell position - may span or shift columns, so the tracer cannot tell which cell sits in which column. Such a table contributes no entries; if it carries a keyword column, that is reported rather than silently dropped, as is a keyword column in a table whose `columns:` argument cannot be counted.
- A table cannot define an item: a cell that holds nothing but a backticked ID is not an item definition and is reported as a problem. Cells in keyword columns are entries and are exempt; an invalid entry there is reported against its keyword column.

Like a keyword line, a keyword table may appear anywhere in the item's definition and terminates the description.

## Definition boundaries

An item's definition extends to the next ID line or heading. An item with an empty `Needs` list terminates a tracing chain.

## Forwarding tags

A line containing nothing but a backticked forwarding tag `` `[<source-id> --> <target-id>]` `` redirects the source item's coverage obligation; see [Forwarding / delegation](forwarding.md). Such a line may appear anywhere - inside an item's definition it is not part of the description. Only the backticked spelling counts: bare, the brackets are content-block delimiters and `--` ligates to an en dash, so the tag would not survive compilation - the bare spelling is reported as a problem instead.

## Reading scope

Parsing is line-based, mirroring the [Markdown grammar](markdown-items.md): the content of code-mode calls other than a line-opening `#table(...)` (a `#figure(...)`, a `#heading(...)`) is read as ordinary lines, and headings are recognized in their `=` markup spelling only.
