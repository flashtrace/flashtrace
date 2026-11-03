# Command line

```
Usage: flashtrace [options] [directory-or-file ...]

Traces requirement coverage between Markdown specifications and source code.
Defaults to the current directory. Files ignored by git are excluded.

Options:
  -t, --tags <t1,t2,...>   only import spec items carrying one of these
                           tags; add "_" to also include untagged items
  -f, --format <format>    report format: "text" (default) or "json"; --json
                           is shorthand for --format json
      --impact <ref>       query reverse dependencies of an item ID or bare key;
                           text format only, cannot be combined with -v
  -v, --verbose            list every item with its coverage status and trace
                           edges, not only the defective ones; text format only
  -V, --version            print the version number
  -h, --help               show this help

Long options also accept "="-attached values, e.g. --tags=a,b.
The report format and the tag filter may each be selected only once.
The impact reference may be selected only once.

Exit codes: 0 clean, 1 defects or problems found, 2 usage error
With --impact: 0 ref exists, 1 no item matches, 2 usage error
```

Long options also accept `=`-attached values, e.g. `--tags=a,b`; values containing spaces must be shell-quoted (`--tags="a , b"`).

The report format and the tag filter may each be selected only once, whichever spelling does it. A second selection is a usage error rather than a silent last-one-wins - `--json --format text` and `-t a -t b` alike - and so is naming one twice with the same value (`--json --format json`): one rule covers all of them, and the error names the option to drop.

Exit codes: `0` clean trace · `1` defects or problems found · `2` usage error.

## Default report

Output is a color-formatted plain-text report to stdout: one block per defective item (ID, title, location, defect list), parse problems, and a summary (item counts, ok/defective, and the deep- versus shallow-covered split of the ok items) ending in `ok` / `not ok`.

With `-f json` (or its shorthand `--json`) the report is a single JSON document instead - see [JSON report](json-report.md). Any other format value is a usage error, as is combining the JSON format with `-v`/`--verbose`: verbosity selects which items the plain-text report lists, and the JSON document always carries them all.

## Verbose report

`-v` replaces the defective-only blocks with a list of *every* item, grouped by file and source line (files in the order [Text handling](text-handling.md) defines). Problems, the summary and the `ok` / `not ok` footer follow unchanged, and the exit codes are unaffected.

Each item carries a status marker matching the three states the summary distinguishes:

- `✔` deep-covered - all needs exist and are themselves deep-covered
- `~` shallow-covered only - the item's own needs are met, but an item further down the tracing chain is defective
- `✘` defective - the defect list follows, as in the default report

Below its status line, an item shows its role-appropriate trace edges:

- a **Markdown item** lists one `needs <ref>` line per `Needs` entry: the covering item's own status mark (`✔` / `~` / `✘`) with its location, or `✘ missing` if nothing satisfies it. Because a need carries the item's coverage obligation, this mark makes a shallow-covered item's broken chain visible in place — a `~` or `✘` here points straight at the failing dependency. A wildcard reference additionally shows each resolved revision as `(→ <resolved-id>)`; an exact reference shows the same arrow when the resolved item spells its revision differently (a need for `#2.4` resolved by an item defined as `#2.4.0`), keeping every defined ID grep-able from the report.
- **every item** lists `wanted by <id>` for each item that needs it. A code item's own needs (from `>>` need tags) are not listed on the item itself — they appear as `wanted by` on their targets (of any origin), and a missing one only as its `uncovered` defect.
- **every item** lists `covers <id>` for each of its `Covers` entries: `✔` with the location of the covered item, or `✘ missing`. Covers is not part of the item's own coverage chain, so this mark reflects only existence; the relation's validation (orphaned, unwanted) is reported through the defect bullets.
- a **forwarding source** shows `→ <target-id>` instead of its needs, which are excused (see [Forwarding](forwarding.md)); the mark is the target's own status, since the source's coverage follows it. Its `Covers` entries are listed unchanged.

```
✔ req:login#1 "Login"  spec.md:2  [deep-covered]
    needs impl:login#2.x (→ impl:login#2.4)  ✔ login.ts:1

✔ impl:login#2.4  login.ts:1  [deep-covered]
    wanted by req:login#1  spec.md:2
```

## Impact query

`--impact <ref>` replaces the coverage report with a reverse dependency query.
Use a full item ID (`--impact impl:auth/login#2.4`) for one revision, or a bare
key (`--impact impl:auth/login`) for every defined revision of that item.
Concrete revisions follow the same SemVer equality as reference resolution.
Long options accept attached values here too: `--impact=impl:auth/login`.
The impact reference may be selected only once. A wildcard query or an
incomplete key is a usage error.

Input paths and `--tags` work as for the coverage report. The query uses the
items left after filtering. Impact is a text report; combining it with
`-v`/`--verbose` or the JSON format is a usage error.

An item directly depends on the target when it **needs** a reference the target
satisfies, **covers** the target, or **forwards to** the target. Needs include
both Markdown `Needs` and code `>>` tags; forwarding uses the effective target
selected by analysis. The query follows all these relations in reverse to find
transitive dependents. Traversal is cycle-safe: the target is excluded from its
own impact set, and each dependent is listed once even when several paths
reach it. Multiple direct edges on an item are all shown beneath that item.

Every direct edge carries a bump classification:

- **exact** — names the revision itself; breaks on bump or removal.
- **tolerant** — a wildcard need that another existing matching revision also
  satisfies; survives removal of this revision. The other matches are listed.
- **wildcard-last** — a wildcard need whose only matching revision is the
  target; breaks on bump or removal, but a same-pattern replacement heals it.

Transitive items carry a `via <id>` explanation naming the preceding item on a
shortest reverse dependency path, without an edge classification. Each queried
revision has its own block, in ascending revision order; direct and transitive
items are ordered by file and source location. The report uses the verbose
report's IDs, titles, locations and arrows, with the same terminal colors and
`NO_COLOR` behavior. Wildcard needs show the full resolved ID in `(→ <id>)`.

```
impact of impl:auth/login#2.4  login.ts:3  (2 direct, 1 transitive)

  direct
    req:auth/login#1 "Login"  spec.md:12
        needs impl:auth/login#2.x (→ impl:auth/login#2.4)  tolerant (also matched by #2.5)
    test:auth/login#3  login.test.ts:7
        covers impl:auth/login#2.4  exact — breaks on bump
  transitive
    req:auth#1 "Authentication"  spec.md:2  via req:auth/login#1
```

A defined item with no dependents prints `no items depend on <id>` to stdout.
An unmatched query prints `no item matches <ref>` to stderr, with the usual
revision-mismatch hint if other revisions of the key exist.

Impact is a query: exit `0` means the reference exists, including empty impact
and projects with coverage defects or parse problems; exit `1` means no item
matches; exit `2` means a usage error (including unreadable input). The coverage
summary and its `ok` / `not ok` footer are replaced by the impact report.
