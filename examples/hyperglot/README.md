# Hyperglot project

Every file extension flashtrace knows, each in a file that exercises every
comment form its grammar offers, and a Markdown spec that exercises every
construct the Markdown parser reads. 83 extensions in 22 folders, one folder per
comment grammar.

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

| Folder | Comment forms | Extensions |
|---|---|---|
| [c-like/](c-like/) | line, block | 20, from `.ts` to `.proto` |
| [c-like-nested/](c-like-nested/) | line, block, nesting block | `.kt` `.kts` `.rs` `.scala` `.swift` |
| [php/](php/) | two line markers, block | `.php` |
| [hash/](hash/) | line | 15, from `.py` to `.gql` |
| [julia/](julia/) | line, block, nesting block | `.jl` |
| [nim/](nim/) | line, block and doc block, both nesting | `.nim` |
| [coffee/](coffee/) | line, block with identical open and close | `.coffee` |
| [powershell/](powershell/) | line, block | `.ps1` `.psm1` |
| [hcl/](hcl/) | two line markers, block | `.hcl` `.tf` `.tfvars` |
| [semicolon/](semicolon/) | line | `.clj` `.cljc` `.cljs` `.edn` `.el` `.lisp` |
| [scheme/](scheme/) | line, nesting block | `.rkt` `.scm` `.ss` |
| [percent/](percent/) | line | `.erl` `.hrl` `.sty` `.tex` |
| [dash-line/](dash-line/) | line | `.adb` `.ads` `.vhd` `.vhdl` |
| [ml/](ml/) | nesting block only | `.ml` `.mli` |
| [fsharp/](fsharp/) | line, nesting block | `.fs` `.fsi` `.fsx` |
| [pascal/](pascal/) | line, two non-nesting blocks | `.dpr` `.pas` |
| [sql/](sql/) | line, block | `.sql` |
| [lua/](lua/) | line, block sharing the line prefix | `.lua` |
| [haskell/](haskell/) | line, nesting block | `.hs` |
| [css/](css/) | block only | `.css` |
| [xml/](xml/) | block only | `.svg` `.xml` |
| [html/](html/) | markup, plus script and style regions | `.htm` `.html` `.svelte` `.vue` |

## What each fixture asserts

- **Blocks span lines.** Every block-comment tag sits on its own line between
  the opener and the closer, so the scanner has to carry the open block across
  lines to find it.
- **Nesting is real.** In a nesting grammar the `-nested` tag sits *after* the
  inner closer. A scanner that ended the comment there would read the tag as
  code and define no item, so these tags only appear when nesting works.
- **The longest opener wins.** Lua's block opener is a longer form of its line
  marker, CoffeeScript opens and closes with the same marker, and Nim's doc
  opener shares a prefix with both its line marker and its plain block opener.
- **Regions switch grammar.** The HTML-family files tag a markup comment, a
  line and a block comment in a plain script, a markup comment in a
  `type="text/html"` script, line and block comments in a `lang="coffee"`
  script, a block comment in a plain style and a line comment in a
  `lang="scss"` style. Their `type="application/json"` script carries
  tag-shaped text that must *not* be picked up - JSON has no comment grammar,
  so it stays data. The item count is what proves it.

Some of these combinations are not idiomatic for the extension they sit in - a
`lang="coffee"` script inside a `.html` document, say. They are there because
the grammar accepts them, and the fixture covers the grammar, not the framework.

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
- **Revisions and wildcards** - the [hash/](hash/) items carry one-, two- and
  three-layer revisions, needed through `#x`, `#x.y`, `#x.y.z`, `#1.x` and
  `#1.2.x`.
- **Forwarding** - `.htm` delegates its coverage obligation to `.html` and
  `.svg` to `.xml`, once as a plain line and once backticked. Both alias
  extensions keep their own needs, so their tags stay wanted.

The run reports no defects and no problems and exits 0; the defect and problem
kinds are shown in [diagnostics](../diagnostics/) instead.
