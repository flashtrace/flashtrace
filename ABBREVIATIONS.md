# Abbreviation Index

Identifiers in this codebase are written out in full.
The abbreviations listed here are the sanctioned exceptions: they are either
domain vocabulary that appears constantly, or conventions so universal that the
long form would hurt readability. Use them consistently - and use no others.

Names Rust itself dictates are not naming choices and fall outside this index:
the `fmt` of `std::fmt` and of a `Display` implementation's method, and the
like.

## Domain vocabulary

| Abbreviation | Meaning | Notes |
|---|---|---|
| `rev` | revision | Part of the item-ID grammar (`<name>#<revision>`, see [docs/revisions.md](docs/revisions.md)); used in names like `rev_of`, `compare_rev`, `rev_matches`, `is_wildcard_rev`, `canonical_rev`. Pluralizes as `revs`. |
| `id` | identifier | An item ID such as `req:auth/login#1`. Pluralizes as `ids`. |
| `ext` | file extension | Always lowercased and without the leading dot (`rs`), as `std::path::Path::extension` yields it; used in `CODE_EXT`, `SPEC_EXT`, `extension_of`. |
| `md` | Markdown | The `.md` file extension; used in names like the `md` fixture parameter carrying Markdown input in the analyze and JSON-report test suites. |
| `url` | Uniform Resource Locator | URL-shaped text (`scheme://…`), exempt from comment detection (see [docs/code-tags.md](docs/code-tags.md)); used in `URL_RE`, `UrlSpan`, `url_spans`. |
| `col` | column | Only the index of a Markdown table column while a row is scanned (`for (col, cell) in …`), alongside the `columns` it indexes. A character column in the output is `character`, spelled in full. |

## Regex conventions (src/ids.rs and the parsers)

| Convention | Meaning |
|---|---|
| `*_SRC` | A constant holding a regex **source string**, kept as a string so it can be composed into larger expressions: `REV_SRC`, `SEGMENT_SRC`, `WILDCARD_SRC`. |
| `*_src` | A function returning such a source string, for the parts that are themselves composed from others: `id_src`, `ref_src`, `path_src`, `rev_ref_src`, `forward_src`. |
| `*_RE` | A compiled regex, held in a `LazyLock`: `ID_RE`, `TAG_RE`, `URL_RE`. |
| `re` | A regex parameter. |
| `m` | A regex match or its captures. |

## Universal programming conventions

These carry no project-specific meaning and are used here as they are used
everywhere else:

`i`, `j`, `k` (loop indices), `idx`, `pos`, `len`, `min`, `max`,
`a`, `b` (comparator operands), `argv`, `args`, `err`,
`cwd`, `dir` (directory), `abs` (absolute path), `memo`,
`out` (accumulated output).

## Single-letter bindings

A single letter is acceptable only where the subject is obvious from the
immediate context and the binding is read within a line or two of where it is
introduced: a comparator closure (`|a, b| compare_rev(a, b)`), a regex match
(`.map(|m| (m.start(), m.len()))`), or a loop index. Anything with a body
spanning multiple lines names its variables properly.
