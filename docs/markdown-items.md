# Markdown items (`.md`, `.markdown`)

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

- **Title** - the `#`-style heading directly above the ID line. Only blank lines may sit between the heading and the ID; if any other text does, the item has *no* title.
- **Description** - the lines following the ID. A single blank line directly under the ID (before the description starts) is permitted. The description ends at the next blank line; everything after that is treated as informative text and skipped.
- **Keywords** - after the description, an item may carry:
  - `Needs:` - the exact IDs of the items required to cover this one. Because needs are explicit IDs, multiple needed items of the same type are possible.
  - `Covers:` - the exact IDs of the items this item covers.
  - `Tags:` - free-form tag names for additional grouping/filtering.

  Each keyword accepts either a one-line comma-separated list or a bullet list (`-`, `*`, `+`) on the immediately following lines. The two styles must not be mixed within one keyword. IDs may optionally be wrapped in backticks.

An item's definition extends to the next ID line or heading. An item with an empty `Needs` list terminates a tracing chain.
