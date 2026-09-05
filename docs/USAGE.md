# Usage Guide

flashtrace traces requirement coverage between Markdown specifications and
source code. It ships as a single native binary with no runtime dependencies.

## Running

```sh
flashtrace [options] [directory-or-file ...]
```

Scans the given directories/files (default: current directory) for Markdown
(`.md`, `.markdown`) and code files across many languages (C-family, Python,
Ruby, shell, SQL, Lua, PowerShell, CSS, HTML/XML, Vue and more - see
[Code tags](code-tags.md) for the full list). Files ignored by git are excluded.
Files are read as UTF-8: a leading byte-order mark is ignored, and bytes that do
not decode are replaced by U+FFFD rather than failing the run.

| Option | Effect |
|---|---|
| `-t, --tags <t1,t2,...>` | Only import spec items carrying one of these tags; add `_` to also include untagged items. Code items are always kept. |
| `-f, --format <format>` | Report format: `text` (default) or `json`. See [JSON report](json-report.md). |
| `--json` | Shorthand for `--format json`. |
| `-v, --verbose` | List every item with its coverage status and trace edges, not only the defective ones. Text format only. See [Command line](command-line.md). |
| `-V, --version` | Print the version number and exit. |
| `-h, --help` | Show help. |

Long options also accept `=`-attached values, e.g. `--tags=a,b`; values
containing spaces must be shell-quoted (`--tags="a , b"`).

The report format and the tag filter may each be selected only once, whichever
spelling does it. A second selection (`--json --format text`, `-t a -t b`) is a
usage error rather than a silent last-one-wins, and the error names the option
to drop. See [Command line](command-line.md).

Exit codes: `0` clean, `1` defects or problems found, `2` usage error.

## Item IDs

```
<type>:[<group>/[<group>/...]]<name>#<revision>
```

Examples: `req:auth/login#1`, `impl:session-store#2.4`. The type is free-form
(e.g. `req`, `impl`, `test`); the revision is a semver-style version with one to
three layers (`X`, `X.Y` or `X.Y.Z`). Omitted layers are zero as in SemVer, so
`2.4` equals `2.4.0`; a `Needs` reference may opt into a range with a wildcard
revision (`x`, `2.x`, `2.3.x` - `*` is an alias for `x`). See the
[Revisions](revisions.md) spec.

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

- **Title** - the heading directly above the ID (only blank lines in between).
- **Description** - the lines following the ID, up to the next blank line.
- **Needs / Covers / Tags** - inline comma-separated or as a bullet list on the
  following lines. A Needs or Covers entry is a full ID or a short form (`impl`,
  `impl:name`, `impl#2`) whose omitted `[group/]name` and revision are taken
  from the item stating it; see [markdown-items.md](markdown-items.md).

## Tagging code

Inside comments (`//`, `/* */`, `--` in SQL, `<!-- -->` in Vue):

```js
// [impl:auth/login#1]           defines a coverage item
// [>>test:auth/login#1]         attaches a need to the nearest preceding
//                               item tag in the same file
// [impl:auth/login#1 >> impl:auth/session#1]
//                               attaches a need to the preceding item tag
//                               with that ID (robust against item
//                               tags inserted in between)
```

## Forwarding / delegation

`[req:login#1 --> dsn:auth#2]` (spaces optional) redirects `req:login#1`'s
coverage obligation: instead of its own `Needs`, it counts as covered exactly
when `dsn:auth#2` exists, and as deep-covered when `dsn:auth#2` is. The tag is
recognized inside code comments and on a standalone line in Markdown
(optionally backticked). At most one forwarding per item, and forwarding
chains must be acyclic.

## Coverage rules

An ID is **covered** when an item with that ID (revisions compared SemVer-equal)
exists. Reported defects:

- **invalid** - a `Needs:`/`Covers:` entry that is not a valid reference; the
  entry is ignored.
- **duplicate** - the same ID is defined more than once.
- **uncovered** - a needed ID does not exist (a hint is shown when other
  revisions of the same item exist).
- **orphaned** - `Covers:` references an ID that does not exist.
- **unwanted** - an item covers something that does not need it back, or a
  code item that nothing needs.
- **cyclic** - the item's forwarding sits on a cycle; it is voided and the
  item falls back to its own needs.

Coverage is checked transitively: an item is only *deep-covered* when all of
its needs exist and are themselves deep-covered. Shallow-covered items are
counted separately in the summary.

Malformed input with no item to attach it to (a `[>>...]` tag with no
preceding item tag, an explicit `[<source-id> >> <id>]` tag whose source item
tag does not precede it) is reported as a **problem** ⚠ alongside the defects.
