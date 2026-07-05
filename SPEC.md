# flashtrace — Requirement Tracing Specification

flashtrace verifies that every requirement defined in Markdown documents is covered by the artifacts it explicitly demands — other requirements or tags in source code. It reports missing, orphaned, unwanted, outdated and duplicated coverage.

## 1. Item IDs

Every traceable item has a project-wide unique ID:

```
<type>:[<group>/]<name>#<revision>
```

- **type** — ASCII letters only (e.g. `feat`, `req`, `dsn`, `impl`, `utest`). Types are free-form; the tool does not hardcode a hierarchy.
- **group** — *optional* grouping segment, separated from the name by `/`.
- **name** — letters, digits, `_`, `-`, `.`; must start with a letter. Same rules apply to group.
- **revision** — non-negative integer. Increment it whenever the item's meaning changes; this invalidates all references that still name the old revision.

Examples: `req:auth/login#1`, `impl:whatever-other-name#2`.

Matching is always by the **exact, full ID** including the revision.

## 2. Markdown items (`.md`, `.markdown`)

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

- **Title** — the `#`-style heading directly above the ID line. Only blank lines may sit between the heading and the ID; if any other text does, the item has *no* title.
- **Description** — the lines following the ID. A single blank line directly under the ID (before the description starts) is permitted. The description ends at the next blank line; everything after that is treated as informative text and skipped.
- **Keywords** — after the description, an item may carry:
  - `Needs:` — the exact IDs of the items required to cover this one. Because needs are explicit IDs, multiple needed items of the same type are possible.
  - `Covers:` — the exact IDs of the items this item covers.
  - `Tags:` — free-form tag names for additional grouping/filtering.

  Each keyword accepts either a one-line comma-separated list or a bullet list (`-`, `*`, `+`) on the immediately following lines. The two styles must not be mixed within one keyword. IDs may optionally be wrapped in backticks.

An item's definition extends to the next ID line or heading. An item with an empty `Needs` list terminates a tracing chain.

## 3. Code tags (`.ts`, `.js`, `.mjs`, `.sql`, `.vue`)

Tags are written inside comments — `//`, `/* … */`, `<!-- … -->` (Vue), or `--` (SQL). Multi-line comment blocks are supported; each tag may sit on its own line inside a block.

- `[<type>:[<group>/]<name>#<revision>]` — defines a coverage item with that ID. It satisfies every `Needs` entry (anywhere in the project) that names this exact ID.
- `[>><type>:[<group>/]<name>#<revision>]` — attaches a need to the *nearest preceding* item tag in the **same file**. If no item tag precedes it, this is reported as an error.

```ts
// [impl:auth/login#1]
// [>>utest:auth/login#1]
export function login(token: SessionToken) { … }
```

Files ignored by git are excluded from scanning (`git ls-files --cached --others --exclude-standard`; a plain directory walk skipping `.git`/`node_modules` is used outside a git repository).

## 4. Coverage rules

- A need `X` of item `A` is **covered** iff an item with the exact ID `X` exists.
- Item `A` is **shallow-covered** iff all of its needs are covered; **deep-covered** iff additionally every needed item is itself deep-covered (transitively, cycle-safe).
- A `Covers: Y` entry on item `A` is **valid** iff item `Y` exists *and* `Y` lists `A`'s exact ID in its `Needs`.

### Defects

| Defect     | Meaning                                                                                     |
|------------|---------------------------------------------------------------------------------------------|
| uncovered  | A needed ID does not exist. If the same `type:group/name` exists at another revision, the report flags the revision mismatch (outdated/predated reference). |
| orphaned   | A `Covers` entry points to a non-existent ID (with the same revision-mismatch hint).         |
| unwanted   | Coverage nobody asked for: a `Covers` entry whose target does not need the coverer's ID, or a code item whose ID is not needed by any item. |
| duplicate  | The same full ID is defined more than once.                                                  |
| problem    | Parse-level error, e.g. a `[>>…]` tag with no preceding item tag, or a malformed ID in a `Needs`/`Covers` list. |

## 5. Command line

```
flashtrace [options] [directory-or-file ...]     # defaults to "."

  -t, --tags <t1,t2,...>   import only Markdown items carrying one of these
                           tags; add "_" to also include untagged items
  -h, --help
```

Output is a color-formatted plain-text report to stdout: one block per defective item (ID, title, location, defect list), parse problems, and a summary (item counts, ok/defective, shallow-only note) ending in `ok` / `not ok`.

Exit codes: `0` clean trace · `1` defects or problems found · `2` usage error.

## 6. Known limitations

- Comment detection is lexical: comment markers inside string literals (e.g. a URL containing `//`) are treated as comments.
- Only `#`-style Markdown headings are recognized as titles (no underlined headings).