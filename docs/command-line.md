# Command line

```
flashtrace [options] [directory-or-file ...]     # defaults to "."

  -t, --tags <t1,t2,...>   import only Markdown items carrying one of these
                           tags; add "_" to also include untagged items
  -h, --help
  -v, --version            print the version number
```

Output is a color-formatted plain-text report to stdout: one block per defective item (ID, title, location, defect list), parse problems, and a summary (item counts, ok/defective, shallow-only note) ending in `ok` / `not ok`.

Exit codes: `0` clean trace · `1` defects or problems found · `2` usage error.
