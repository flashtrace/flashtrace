# Command line

```
flashtrace [options] [directory-or-file ...]     # defaults to "."

  -t, --tags <t1,t2,...>   only import spec items carrying one of these
                           tags; add "_" to also include untagged items
  -f, --format <format>    report format: "text" (default) or "json"; --json
                           is shorthand for --format json
  -v, --verbose            list every item with its coverage status and trace
                           edges, not only the defective ones; text format only
  -V, --version            print the version number
  -h, --help
```

Long options also accept `=`-attached values, e.g. `--tags=a,b`; values containing spaces must be shell-quoted (`--tags="a , b"`).

The report format and the tag filter may each be selected only once, whichever spelling does it. A second selection is a usage error rather than a silent last-one-wins - `--json --format text` and `-t a -t b` alike - and so is naming one twice with the same value (`--json --format json`): one rule covers all of them, and the error names the option to drop.

Exit codes: `0` clean trace · `1` defects or problems found · `2` usage error.

## Default report

Output is a color-formatted plain-text report to stdout: one block per defective item (ID, title, location, defect list), parse problems, and a summary (item counts, ok/defective, and the deep- versus shallow-covered split of the ok items) ending in `ok` / `not ok`.

With `-f json` (or its shorthand `--json`) the report is a single JSON document instead - see [JSON report](json-report.md). Any other format value is a usage error, as is combining the JSON format with `-v`/`--verbose`: verbosity selects which items the plain-text report lists, and the JSON document always carries them all.

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
