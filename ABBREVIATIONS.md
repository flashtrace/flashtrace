# Abbreviation Index

Identifiers in this codebase are written out in full.
The abbreviations listed here are the sanctioned exceptions: they are either
domain vocabulary that appears constantly, or conventions so universal that the
long form would hurt readability. Use them consistently - and use no others.

## Domain vocabulary

| Abbreviation | Meaning | Notes |
|---|---|---|
| `rev` | revision | Part of the item-ID grammar (`<name>#<revision>`, see [docs/revisions.md](docs/revisions.md)); used in names like `revOf`, `compareRev`, `revMatches`, `isWildcardRev`. |
| `id` | identifier | An item ID such as `req:auth/login#1`. |
| `ext` | file extension | Always lowercased, with the leading dot (`.mjs`). |
| `md` | Markdown | The `.md` file extension; used in names like the `md` fixture parameter carrying Markdown input in `test/analyze.test.mjs`. |
| `url` | Uniform Resource Locator | URL-shaped text (`scheme://…`), exempt from comment detection (see [docs/code-tags.md](docs/code-tags.md)); used in `URL_RE`, `urlSpans`. |

## Regex conventions (src/ids.mjs and the parsers)

| Convention | Meaning |
|---|---|
| `*_SRC` | A regex **source string**, kept as a string so it can be composed into larger expressions. |
| `*_RE` | A compiled `RegExp`. |
| `re` | A `RegExp` parameter. |
| `m` | A regex match result (`String.prototype.match` / `RegExp.prototype.exec`). |

## Universal programming conventions

These carry no project-specific meaning and are used as everywhere else:

`i`, `j`, `k` (loop indices), `idx`, `pos`, `len`, `min`, `max`,
`a`, `b` (comparator operands), `argv`, `opts`, `err`, `res`, `prev`,
`cwd`, `dir` (directory), `abs` (absolute path), `pkg` (package), `attr` (attribute),
`memo`, `out` (accumulated output).

## Single-letter parameters

A single-letter parameter is acceptable only in a single-expression arrow
function whose subject is obvious from the immediate context, e.g.
`(s) => s.trim()`. Anything with a body spanning multiple lines names its
variables properly.
