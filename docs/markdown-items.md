# Markdown items (`.md`, `.markdown`)

An item is defined by a line that contains nothing but its ID in backticks:

```markdown
### Login requires a valid session token
`req:auth/login#1`

The system only accepts requests that carry a valid session token.
A second line still belongs to the description.

Everything after the blank line above is informative and ignored.

Needs: impl:auth/login#1, utest:auth/login#1

Covers:
- feat:auth#1

Tags: Auth, Security
```

- **Title** - the heading directly above the ID line, either ATX (`#`-style) or setext (a paragraph underlined with `===` for level 1 or `---` for level 2). Only blank lines may sit between the heading and the ID; if any other text does, the item has *no* title. A setext underline counts only when a paragraph line sits directly above it, so a thematic break, a table delimiter row, or a bullet list is not read as a heading. As in CommonMark, a setext heading folds its whole paragraph into the title, and those lines belong to the title alone - they never double as the previous item's description. In a multi-line title, each line is trimmed and the lines are joined with a single space - the whitespace a renderer shows for a soft line break; a line ending in two or more spaces spells a hard line break (CommonMark) and joins with a newline instead. A pipe alone does not make a line a table row: as in GFM, a pipe-carrying paragraph above an underline is a setext heading with the pipe in its text. Only a line inside an actual table (a header row followed by a matching delimiter row) is ruled out - see below. A keyword line, a forwarding line, or an ID line folded into a setext title is heading text like any other: it serves the heading, not its usual role - a keyword or forward is ignored, exactly as `# Covers: ...` is a heading, not a keyword. An ID line so folded cannot also define an item: with no blank line below it, the ID is part of the following paragraph's heading, so the tracer reports it and creates no item. Put a blank line under the ID to keep it a standalone definition.
- **Description** - the lines following the ID. A single blank line directly under the ID (before the description starts) is permitted. The description ends at the next blank line; everything after that is treated as informative text and skipped.
- **Keywords** - after the description, an item may carry:
  - `Needs:` - the IDs of the items required to cover this one. Because needs are explicit IDs, multiple needed items of the same type are possible. A need may use a [wildcard revision](revisions.md#wildcard-revisions) (e.g. `impl:auth/login#2.x`) to accept any matching downstream revision.
  - `Covers:` - the exact IDs of the items this item covers (concrete revisions only).
  - `Tags:` - free-form tag names for additional grouping/filtering.

  Each keyword accepts a one-line comma-separated list, a bullet list (`-`, `*`, `+`) on the immediately following lines, or a table column (see below). The inline and bullet styles must not be mixed within one keyword. IDs may optionally be wrapped in backticks.

## Keyword entries from tables

A table column headed by a bare keyword name (`Needs`, `Covers`, or `Tags` - no colon) contributes each row's cell in that column as one entry:

```markdown
| Feature | Needs              | Covers      | Owner |
|---------|--------------------|-------------|-------|
| Login   | impl:auth/login#1  | feat:auth#1 | Alice |
| Logout  | impl:auth/logout#1 |             | Bob   |
```

- As in GitHub-flavored Markdown, the leading and trailing `|` of a row are optional, but every row must contain at least one `|`. The header row must be followed by a delimiter row with the same number of cells (dashes, alignment colons allowed) - a count mismatch degrades the block to plain text.
- The keyword column may sit at any position, and one table may combine several keyword columns. All other columns are ignored by the tracer.
- A cell holds at most one entry; empty (or missing) cells are skipped. Multiple entries simply mean multiple rows.
- A table whose header contains no keyword cell is ordinary informative text.
- A table extends to the first blank line, ATX heading, or thematic break (a `---` run of three or more dashes). As in GFM, the break ends the table as plain text: it is no row and it underlines no heading. A `===` run, a dash run too short for a break (`-`, `--`), or an item-definition line directly under a table row is instead swallowed as a single-cell row, exactly as GFM renders it: its text fills the row's first column, so it neither ends the table nor underlines a heading - nor defines an item. Put a blank line between a table and the next item's ID line to keep it a definition.
- A table cannot define an item: a cell that holds nothing but a backticked ID is not an item definition and is reported as a problem - this includes an ID line swallowed as a row. Cells in keyword columns are entries (optionally backticked) and are exempt; an invalid entry there is reported against its keyword column.

Like a keyword line, a keyword table may appear anywhere in the item's definition and terminates the description.

## Definition boundaries

An item's definition extends to the next ID line or heading. An item with an empty `Needs` list terminates a tracing chain.

## Forwarding tags

A line containing nothing but a forwarding tag `[<source-id> --> <target-id>]` (optionally wrapped in backticks) redirects the source item's coverage obligation; see [Forwarding / delegation](forwarding.md). Such a line may appear anywhere - inside an item's definition it is not part of the description.
