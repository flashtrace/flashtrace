# Hyperglot project

Every file extension flashtrace knows, each in a file that exercises every
comment form its grammar offers, and a Markdown spec that exercises every
construct the Markdown parser reads. One folder per comment grammar, one file
per extension inside it.

Extensions share a folder only when they resolve to the very same grammar - not
when they merely look alike. That is why `.scss` and `.less` sit under
[c-like/](c-like/) (their grammar is the C-like one) while `.css` has a folder
of its own (block comments, no line comments), and why the nesting C-family
lives apart from the non-nesting one in [c-like-nested/](c-like-nested/).

## The tracing chain

The spec is three levels deep, so each level states one thing:

1. [spec.md](spec.md) defines one feature item per grammar, `feat:support-grammar/<folder>#1`.
2. Each folder's `spec.md` covers that feature item and needs one requirement per extension.
3. Each extension requirement needs the item tags its fixture file defines - one per comment form.

Because an unneeded code item is a defect, every tag in every fixture file is
reachable from the root spec; the run is clean and exits 0.

## The grammars

Which extensions each folder holds is what the folder itself shows, so it is
not repeated here - only what its grammar offers.

| Folder | Comment forms |
|---|---|
| [c-like/](c-like/) | line, block |
| [c-like-nested/](c-like-nested/) | line, block, nesting block |
| [php/](php/) | two line markers, block |
| [hash/](hash/) | line |
| [julia/](julia/) | line, block, nesting block |
| [nim/](nim/) | line, block and doc block, both nesting |
| [coffee/](coffee/) | line, block with identical open and close |
| [powershell/](powershell/) | line, block |
| [hcl/](hcl/) | two line markers, block |
| [semicolon/](semicolon/) | line |
| [scheme/](scheme/) | line, nesting block |
| [percent/](percent/) | line |
| [dash-line/](dash-line/) | line |
| [ml/](ml/) | nesting block only |
| [fsharp/](fsharp/) | line, nesting block |
| [pascal/](pascal/) | line, two non-nesting blocks |
| [sql/](sql/) | line, block |
| [lua/](lua/) | line, block sharing the line prefix |
| [haskell/](haskell/) | line, nesting block |
| [css/](css/) | block only |
| [xml/](xml/) | block only |
| [html/](html/) | markup, plus script and style regions |

## What each fixture asserts

- **Blocks span lines.** Every block-comment tag sits on its own line between
  the opener and the closer, so the scanner has to carry the open block across
  lines to find it.
- **Nesting is real.** A nesting grammar's block carries one tag at each depth
  the nesting creates. The `/deep` tag sits inside the inner block, so it
  asserts that region is scanned exactly once - a scanner that read it again as
  part of the outer block would define the ID twice, which is a duplicate
  defect. The `/after-close` tag sits *after* the inner closer, where only a
  scanner that counts depth is still inside the comment; a scanner that ended
  the comment there would read the tag as code and define no item. Scanning
  [c-like-nested/rs.rs](c-like-nested/rs.rs) with the non-nesting C-like grammar
  yields 3 items instead of 4, and the missing one is `/after-close`.
- **The longest opener wins.** Lua's block opener is a longer form of its line
  marker, CoffeeScript opens and closes with the same marker, and Nim's doc
  opener shares a prefix with both its line marker and its plain block opener.
- **Regions switch grammar.** All four HTML-family files tag a markup comment,
  a line and a block comment in a plain script, and a block comment in a plain
  style. Past that they split by convention: the single-file components
  (`.vue`, `.svelte`) add a `lang="coffee"` script and a `lang="scss"` style,
  while the plain documents (`.html`, `.htm`) add a `type="text/html"` inline
  template. In a plain document a `lang` attribute is HTML's own
  natural-language one, so it belongs to the component files only. All four
  resolve to a single grammar, so the folder still covers every branch of the
  region resolver.
- **A comment-less region stays data.** The `type="application/json"` script in
  the plain documents carries tag-shaped text that must *not* be picked up.
  Nothing renders its absence - the item count is what proves it.

## What the spec asserts

The Markdown constructs are spread across the folder specs rather than piled
into one file:

- **Titles** - ATX headings, single-line setext headings underlined with `=`
  and with `-`, and in [hash/spec.md](hash/spec.md) a two-line paragraph that
  folds into one setext title.
- **Keyword lists** - `Needs` inline and comma-separated, as `-`, `*` and `+`
  bullet lists, and as a table column beside a `Tags` column. A table cell is
  one entry, so a `Tags` column contributes one tag per row.
- **`Covers`** - each folder item covers the feature item that needs it back.
- **Reference forms** - full IDs, `impl:hash/toml` (revision taken from the
  stating item), `impl#1.2` (name taken) and bare `impl` (both taken).
- **Group paths** - the nesting fixtures' tags carry a two-segment group
  (`impl:c-like-nested/rs-nested/deep#1`); every other ID here nests its group
  path one level only.
- **Revisions and wildcards** - the [hash/](hash/) items carry one-, two- and
  three-layer revisions, needed through `#x`, `#x.y`, `#x.y.z`, `#1.x` and
  `#1.2.x`.
- **Forwarding** - `.htm` delegates its coverage obligation to `.html` and
  `.svg` to `.xml`, once as a plain line and once backticked. Both alias
  extensions keep their own needs, so their tags stay wanted.

The run reports no defects and no problems and exits 0; the defect and problem
kinds are shown in [diagnostics](../diagnostics/) instead.

## Keeping it complete

These files are written by hand like any other example, but the example is only
worth its name while it covers every extension flashtrace scans. So
`test/hyperglot.test.mjs` ties the two together: every extension in
`src/languages.mjs` must have a fixture here, each fixture must be named after
its extension and sit in the folder of its comment grammar, and each must tag
every comment form that grammar offers. CI runs the suite on every pull request,
so a change teaching flashtrace a new extension cannot land without the fixture
that exercises it.

Adding an extension therefore means adding one file named after it to the folder
of its grammar - a new folder when the grammar itself is new - and needing its
tags from that folder's `spec.md`. Changing a fixture also means refreshing the
end-to-end snapshots, which pin this example's report byte-for-byte:

```sh
FLASHTRACE_UPDATE_SNAPSHOTS=1 pnpm test
```
