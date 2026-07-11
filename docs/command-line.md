# Command line

```
flashtrace [options] [directory-or-file ...]     # defaults to "."

  -t, --tags <t1,t2,...>   import only Markdown items carrying one of these
                           tags; add "_" to also include untagged items
  -v, --verbose            list every item with its coverage status and trace
                           edges, not only the defective ones
  -h, --help
  -v, --version            print the version number
```

Output is a color-formatted plain-text report to stdout: one block per defective item (ID, title, location, defect list), parse problems, and a summary (item counts, ok/defective, shallow-only note) ending in `ok` / `not ok`.

Exit codes: `0` clean trace · `1` defects or problems found · `2` usage error.

## Verbose report

`-v` replaces the defective-only blocks with a list of *every* item, grouped by file and source line. Problems, the summary and the `ok` / `not ok` footer follow unchanged, and the exit codes are unaffected.

Each item carries a status marker matching the three states the summary distinguishes:

- `✔` deep-covered - all needs exist and are themselves deep-covered
- `~` shallow-covered only - the item's own needs are met, but an item further down the tracing chain is defective
- `✘` defective - the defect list follows, as in the default report

Below its status line, an item shows its role-appropriate trace edges:

- a **Markdown item** lists one `needs <ref>` line per `Needs` entry: `✔` with the location of the covering item, or `✘ missing`. A wildcard reference additionally shows each resolved revision as `(→ <resolved-id>)`.
- a **code item** lists `wanted by <id>` for every item that needs it.
- a **forwarding source** shows `→ <target-id>` instead of its needs, which are excused (see [Forwarding](forwarding.md)).

```
✔ req:login#1 "Login"  spec.md:2  [deep-covered]
    needs impl:login#2.x (→ impl:login#2.4)  ✔ login.ts:1

✔ impl:login#2.4  login.ts:1  [deep-covered]
    wanted by req:login#1  spec.md:2
```
