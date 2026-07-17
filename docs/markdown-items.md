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

- **Title** - the heading directly above the ID line, either ATX (`#`-style) or setext (a paragraph line underlined with `===` for level 1 or `---` for level 2). Only blank lines may sit between the heading and the ID; if any other text does, the item has *no* title. A setext underline counts only when a paragraph line sits directly above it, so a thematic break, a table delimiter row, or a bullet list is not read as a heading.
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

Like a keyword line, a keyword table may appear anywhere in the item's definition and terminates the description.

An item's definition extends to the next ID line or heading. An item with an empty `Needs` list terminates a tracing chain.

A line containing nothing but a forwarding tag `[<source-id> --> <target-id>]` (optionally wrapped in backticks) redirects the source item's coverage obligation; see [Forwarding / delegation](forwarding.md). Such a line may appear anywhere - inside an item's definition it is not part of the description.

## Placement of the ID line

flashtrace reads an ID line by its content alone, but GitHub-flavored Markdown assigns meaning by context: the same line can render as a paragraph, a table row, or a heading depending on its neighbours. The guiding rule:

> An item ID line is cleanly placed only where the rendered page shows it as a paragraph of its own.

Rule of thumb: **an item ID needs a blank line or its heading directly above, and two items always need a blank line between them.**

A badly placed item is still created - flashtrace never suppresses a definition - but a problem is reported. The severity follows the general [error/warning distinction](command-line.md): an **error** means the rendered page and flashtrace disagree about what the line is, so the item's identity cannot be properly used; a **warning** means the page renders fine, but flashtrace deliberately does not read the reference.

### Errors

- **ID absorbed into a table.** Once a header row and its delimiter row establish a table, GFM absorbs every following non-blank line as a row - even a line without pipes - until a blank line or the start of another block (such as a heading) ends the table. An ID line absorbed this way renders as a single-cell table row:

  ```markdown
  title 1 | title 2
  --- | ---
  Login | Logout
  `req:a#1`
  ```

  This applies to every table, including purely informative ones without keyword columns. Separate the ID from the table with a blank line.

- **ID in the middle of a paragraph.** A non-blank line directly above the ID that is not a heading (an ATX `#` line or a setext underline) makes the ID a continuation line of that paragraph on the rendered page. Two ID lines stacked without a blank line between them are the same mistake.

- **ID directly above a setext underline.** A run of `===` or `---` directly under the ID renders the ID itself as a heading. As a deliberate flashtrace choice, item IDs are never heading text - separate the ID and the underline with a blank line.

### Warnings

- **Backticked ID in prose**, e.g. "see \`req:other#1\` for details" in a description, informative text, or an informative table cell. flashtrace parses strictly; an informative ID reference cannot be understood and should not be used. IDs in keyword lines, bullet entries under a keyword line, keyword table cells, and forwarding lines are read as usual and never warn. A bare, unbackticked ID in prose is plain text and is not reported.

- **ID line inside a blockquote**, e.g. `> ` followed by a backticked ID. A quoted line does not define an item; the warning points out that the definition is ignored.
