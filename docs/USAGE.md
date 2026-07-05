# Usage Guide

flashtrace traces requirement coverage between Markdown specifications and
source code. It has no runtime dependencies and runs anywhere Node.js ≥ 18 is
available.

## Running

```sh
flashtrace [options] [directory-or-file ...]
```

Scans the given directories/files (default: current directory) for Markdown
(`.md`, `.markdown`) and code files (`.ts`, `.js`, `.mjs`, `.sql`, `.vue`).
Files ignored by git are excluded.

| Option | Effect |
|---|---|
| `-t, --tags <t1,t2,...>` | Only import Markdown items carrying one of these tags; add `_` to also include untagged items. Code items are always kept. |
| `-h, --help` | Show help. |

Exit codes: `0` clean, `1` defects or problems found, `2` usage error.

## Item IDs

```
<type>:[<group>/[<group>/...]]<name>#<revision>
```

Examples: `req:auth/login#1`, `impl:session-store#2`. The type is free-form
(e.g. `req`, `impl`, `test`); the revision is a number.

## Defining items in Markdown

An item is a line containing only its ID in backticks. Around it:

```markdown
## Login requirement

`req:auth/login#1`

Users must be able to log in with email and password.

Needs: impl:auth/login#1, test:auth/login#1
Covers:
- req:auth#1
Tags: security
```

- **Title** — the heading directly above the ID (only blank lines in between).
- **Description** — the lines following the ID, up to the next blank line.
- **Needs / Covers / Tags** — inline comma-separated or as a bullet list on the
  following lines. Needs/Covers take full, explicit IDs.

## Tagging code

Inside comments (`//`, `/* */`, `--` in SQL, `<!-- -->` in Vue):

```js
// [impl:auth/login#1]           defines a coverage item
// [>>test:auth/login#1]         attaches a need to the nearest preceding
//                               item tag in the same file
```

## Coverage rules

An ID is **covered** when an item with exactly that ID (including revision)
exists. Reported defects:

- **duplicate** — the same ID is defined more than once.
- **uncovered** — a needed ID does not exist (a hint is shown when other
  revisions of the same item exist).
- **orphaned** — `Covers:` references an ID that does not exist.
- **unwanted** — an item covers something that does not need it back, or a
  code item that nothing needs.

Coverage is checked transitively: an item is only *deep-covered* when all of
its needs exist and are themselves deep-covered. Shallow-covered items are
counted separately in the summary.

Malformed input (invalid IDs in Needs/Covers lists, a `[>>...]` tag with no
preceding item tag) is reported as a **problem** ⚠ alongside the defects.
