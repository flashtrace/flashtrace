# Command line

```
flashtrace [options] [directory-or-file ...]     # defaults to "."

  -t, --tags <t1,t2,...>   import only Markdown items carrying one of these
                           tags; add "_" to also include untagged items
  -v, --verbose            list every item with its coverage status and trace
                           edges, not only the defective ones
      --html[=<path>]      also write a self-contained HTML report
                           (default path: flashtrace.html)
      --html-only[=<path>] write the HTML report instead of the stdout report
  -V, --version            print the version number
  -h, --help
```

Long options also accept `=`-attached values, e.g. `--tags=a,b`; values containing spaces must be shell-quoted (`--tags="a , b"`).

Output is a color-formatted plain-text report to stdout: one block per defective item (ID, title, location, defect list), parse problems, and a summary (item counts, ok/defective, shallow-only note) ending in `ok` / `not ok`.

Exit codes: `0` clean trace · `1` defects or problems found · `2` usage error.

## Verbose report

`-v` replaces the defective-only blocks with a list of *every* item, grouped by file and source line. Problems, the summary and the `ok` / `not ok` footer follow unchanged, and the exit codes are unaffected.

Each item carries a status marker matching the three states the summary distinguishes:

- `✔` deep-covered - all needs exist and are themselves deep-covered
- `~` shallow-covered only - the item's own needs are met, but an item further down the tracing chain is defective
- `✘` defective - the defect list follows, as in the default report

Below its status line, an item shows its role-appropriate trace edges:

- a **Markdown item** lists one `needs <ref>` line per `Needs` entry: the covering item's own status mark (`✔` / `~` / `✘`) with its location, or `✘ missing` if nothing satisfies it. Because a need carries the item's coverage obligation, this mark makes a shallow-covered item's broken chain visible in place — a `~` or `✘` here points straight at the failing dependency. A wildcard reference additionally shows each resolved revision as `(→ <resolved-id>)`.
- **every item** lists `wanted by <id>` for each item that needs it. A code item's own needs (from `>>` need tags) are not listed on the item itself — they appear as `wanted by` on their targets (of any origin), and a missing one only as its `uncovered` defect.
- **every item** lists `covers <id>` for each of its `Covers` entries: `✔` with the location of the covered item, or `✘ missing`. Covers is not part of the item's own coverage chain, so this mark reflects only existence; the relation's validation (orphaned, unwanted) is reported through the defect bullets.
- a **forwarding source** shows `→ <target-id>` instead of its needs, which are excused (see [Forwarding](forwarding.md)); the mark is the target's own status, since the source's coverage follows it. Its `Covers` entries are listed unchanged.

```
✔ req:login#1 "Login"  spec.md:2  [deep-covered]
    needs impl:login#2.x (→ impl:login#2.4)  ✔ login.ts:1

✔ impl:login#2.4  login.ts:1  [deep-covered]
    wanted by req:login#1  spec.md:2
```

## HTML report

`--html` writes an HTML report in addition to the stdout report; `--html-only` writes it instead of the stdout report. The default output file is `flashtrace.html` in the current working directory. A custom path must be attached with `=` (`--html=out/report.html`) — a space-separated value would be ambiguous with a scan directory; missing parent directories are created, an existing file is overwritten. Giving both flags is a usage error.

With either flag, stdout carries a `report written to <path>` line directly before the final `ok` / `not ok`; with `--html-only` these two lines are the entire output. Exit codes are unchanged.

The file is fully self-contained — inline CSS and vanilla JavaScript, the report data embedded as JSON, no external requests — so it can be opened from disk, kept, and shared as a single file. Its output is deterministic: the same tree state produces a byte-identical file.

The page shows:

- a header with the summary counts, a prominent `ok` / `not ok` verdict, the scanned paths, the active `--tags` filter (when given), and the flashtrace version. There is no timestamp.
- a tab bar switching between **Show problems** (the default report's content: one block per defective item plus the parse problems) and **Show all (verbose)** (the verbose report's content: every item grouped by file with its status mark and trace edges, as specified above).

Both views are always contained in the file; `-v` only affects the stdout report.
