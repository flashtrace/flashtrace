# Code tags

Tags are written inside comments. The comment style is chosen per file extension, so the same tag syntax works across many languages. Multi-line comment blocks are supported; each tag may sit on its own line inside a block.

## Comment styles

| Comment family | Line | Block | Extensions |
|---|---|---|---|
| C-like | `//` | `/* … */` | `.ts` `.js` `.mjs` `.cjs` `.jsx` `.tsx` `.cts` `.mts` `.c` `.h` `.cpp` `.cc` `.hpp` `.cxx` `.hxx` `.ino` `.inl` `.tpp` `.cs` `.java` `.go` `.groovy` `.gradle` `.sol` `.dart` `.proto` `.scss` `.less` |
| C-like, nesting | `//` | `/* … */` (nestable) | `.rs` `.swift` `.kt` `.kts` `.scala` |
| PHP | `//` `#` | `/* … */` | `.php` |
| Hash | `#` | – | `.py` `.rb` `.sh` `.bash` `.zsh` `.yaml` `.yml` `.toml` `.r` `.pm` `.ex` `.exs` `.tcl` `.cr` `.gd` `.awk` `.graphql` `.gql` |
| CoffeeScript | `#` | `### … ###` (opener not followed by `#`) | `.coffee` |
| Julia | `#` | `#= … =#` (nestable) | `.jl` |
| Nim | `#` | `#[ … ]#` `##[ … ]##` (nestable) | `.nim` |
| CMake | `#` | `#[[ … ]]` | `.cmake` |
| PowerShell | `#` | `<# … #>` | `.ps1` `.psm1` |
| HCL | `#` `//` | `/* … */` | `.tf` `.tfvars` `.hcl` |
| Semicolon | `;` | – | `.clj` `.cljs` `.cljc` `.edn` `.el` `.lisp` |
| Scheme/Racket | `;` | `#\| … \|#` (nestable) | `.scm` `.ss` `.rkt` |
| Percent | `%` | – | `.erl` `.hrl` `.tex` `.sty` |
| SQL | `--` | `/* … */` | `.sql` |
| Dash (line only) | `--` | – | `.adb` `.ads` `.vhd` `.vhdl` |
| Lua | `--` | `--[[ … ]]` | `.lua` |
| Haskell | `--` | `{- … -}` (nestable) | `.hs` `.elm` `.purs` |
| ML-family | `//` (F#) | `(* … *)` (nestable) | `.ml` `.mli` `.fs` `.fsi` `.fsx` |
| Pascal | `//` | `{ … }`, `(* … *)` | `.pas` `.dpr` |
| CSS | – | `/* … */` | `.css` |
| HTML/XML | – | `<!-- … -->` | `.xml` `.svg` |
| HTML + embedded | – | `<!-- … -->` (markup) | `.html` `.htm` `.vue` `.svelte` |

In CoffeeScript a run of four or more `#` is a line comment, not a block opener, so a `#### Section` heading or a `##########` divider comments out only its own line.

## HTML and embedded languages

HTML-family files switch comment style by region: `<!-- … -->` in markup, C-like comments (`//`, `/* … */`) inside `<script>`, and CSS comments (`/* … */`) inside `<style>`. So a `//` in template text is *not* treated as a comment - only a real HTML comment is. A region ends at the first `</script>`/`</style>` (as a browser tokenizes it), so a literal `</script>` meant as script text should be written `<\/script>`.

The embedded grammar follows the tag's `type`/`lang` attribute: `<script type="application/json">` is scanned with no comments (so a `//` in a JSON string is not one), `<script type="text/x-template">` as HTML markup, and `<style lang="scss">` / `less` / `sass` also honour `//`.

## Strings

A comment marker inside a string literal opens no comment, so `"// [impl:a#1]"` in TypeScript or `'# [impl:a#1]'` in Python defines no item, while a comment after the closed string still counts. The string forms are chosen per file extension, next to the comment style:

| String family | Forms | Extensions |
|---|---|---|
| Double-quoted and character | `"…"` and `'c'`, backslash escapes | `.c` `.h` `.cpp` `.cc` `.hpp` `.cxx` `.hxx` `.ino` `.inl` `.tpp` `.cs` `.java` `.kt` `.kts` `.scala` `.rs` `.cr` `.jl` `.nim` `.ml` `.mli` `.fs` `.fsi` `.fsx` `.hs` `.elm` |
| Double-quoted | `"…"`, backslash escapes | `.swift` `.awk` `.graphql` `.gql` `.cmake` `.hcl` `.tf` `.tfvars` `.purs` |
| Double- and single-quoted | `"…"` and `'…'`, backslash escapes | `.py` `.rb` `.r` `.gd` `.coffee` `.lua` `.php` `.groovy` `.gradle` `.dart` `.sol` `.proto` `.scss` `.css` |
| JavaScript | `"…"`, `'…'` and `` `…` ``, backslash escapes | `.ts` `.js` `.mjs` `.cjs` `.cts` `.mts`, and `<script>` regions |
| Go | `"…"` and `'c'` with backslash escapes, `` `…` `` without | `.go` |
| TOML | `"…"` with backslash escapes, `'…'` without | `.toml` |
| SQL | `'…'` and `"…"`, quote doubled | `.sql` |
| Pascal | `'…'`, quote doubled | `.pas` `.dpr` |
| Ada/VHDL | `"…"` (quote doubled) and `'c'` | `.adb` `.ads` `.vhd` `.vhdl` |
| PowerShell | `'…'` (quote doubled) and `"…"` (backtick escapes) | `.ps1` `.psm1` |
| Clojure | `"…"` and `\c` | `.clj` `.cljs` `.cljc` |
| Lisp | `"…"` and `#\c` | `.lisp` `.scm` `.ss` `.rkt` |
| Erlang | `"…"`, `'…'` and `$c` | `.erl` `.hrl` |
| Elixir | `"…"`, `'…'` and `?c` | `.ex` `.exs` |

The `<style>` regions of HTML-family files use the double- and single-quoted family for CSS and SCSS, and `lang="coffee"` scripts use it as well.

- **Single-line only.** A string still open at the end of its line ends there. Multi-line forms - triple quotes, raw strings, heredocs, template literals across lines - are followed on their opening line only; their further lines are scanned as code.
- **Escapes.** Where a language escapes with a backslash (or PowerShell's backtick), the character after it never closes the string. A language that doubles the quote instead (`'it''s'`) needs no escape: the doubled quote closes the string and opens the next one at once.
- **Character literals.** `'c'` matches one character or one escape sequence between apostrophes, and nothing else. An apostrophe that starts no such literal - a Rust lifetime `'a`, a digit separator `1'000`, a type variable `'a`, a prime `foldl'`, an attribute `Text'Length` - is ordinary code and hides nothing.
- **Prefixed characters.** `\c`, `#\c`, `$c` and `?c` take exactly the next character (or an escape and its character), so `$%` in Erlang or `#\;` in Scheme opens no comment.
- **URLs** get no special treatment: in a string they are hidden with the string, and outside one their `//`, `#` or `--` opens a comment like any other marker - `note://[impl:a#1]` defines `impl:a#1`.

Extensions not listed in the table have no string family, and markers inside their strings still open comments: shell (`.sh` `.bash` `.zsh`), YAML, Perl, Tcl and LaTeX, whose quotes depend on word position or do not exist; XML/HTML markup and JSX/TSX, whose text may hold unpaired quotes; and Less, Emacs Lisp and EDN, whose string syntax is not yet validated. See [Known limitations](known-limitations.md).

## Tag forms

- `[<type>:[<group>/…]<name>#<revision>]` - defines a coverage item with that ID. It satisfies every `Needs` entry (anywhere in the project) that names this ID - revisions compared SemVer-equal, so `#2.4` satisfies a need for `#2.4.0`.
- `[>><type>:[<group>/…]<name>#<revision>]` - attaches a need to the *nearest preceding* item tag in the **same file**. If no item tag precedes it, this is reported as an error.
- `[<source-id> >> <target-id>]` - attaches the need `<target-id>` to the *preceding item tag with* `<source-id>` (a SemVer-equal revision spelling counts) in the **same file** (spaces around `>>` optional). If no such item tag precedes it, this is reported as an error. Unlike the implicit form, it stays attached to its item even when another item tag is later inserted in between.

The need target of either form may use a [wildcard revision](revisions.md#wildcard-revisions) (e.g. `[>>utest:auth/login#2.x]`) or a **short form** that drops whatever the item the need attaches to already fixes - its `[group/…]name`, its `#<revision>`, or both. After `[impl:auth/login#1]`, the tag `[>>utest#1]` demands `utest:auth/login#1` (name taken from the anchor), `[>>utest:auth/audit]` demands `utest:auth/audit#1` (revision taken), and `[>>utest]` demands `utest:auth/login#1` (both taken). Only the leading `<type>` is mandatory. The item tag and the `<source-id>` anchor must name a full ID with a concrete revision.
- `[<source-id> --> <target-id>]` - forwards the source item's coverage obligation to the target; see [Forwarding / delegation](forwarding.md). It defines no item and does not anchor `[>>…]` tags.

```ts
// [impl:auth/login#1]
// [>>utest:auth/login#1]
export function login(token: SessionToken) { … }
```

The explicit form keeps the attachment stable when tags sit further apart:

```ts
// [impl:auth/login#1]
export function login(token: SessionToken) {
  // [impl:auth/audit#1]  <- would steal a [>>…] tag placed below
  audit(token);
  // [impl:auth/login#1 >> impl:auth/session#1]
  return openSession(token);
}
```

Neither need form defines an item or moves the anchor of later `[>>…]` tags.

## File selection

Directory scanning evaluates ignore rules directly in Rust; no Git executable is
required or launched. It respects parent and nested `.gitignore` and `.ignore`
files, `.git/info/exclude`, and the user's global Git ignore file (including
`core.excludesFile` in the user's Git configuration). `.ignore` takes precedence
over `.gitignore`. These rules also apply outside Git repositories; parent rules
can apply from above a repository root.

Hidden files and directories such as `.github/` remain eligible. `.git/` metadata
and `node_modules/` dependency directories are always excluded from traversal,
including when supplied as directory scan roots. Directory
symlinks are not followed, and symlink entries discovered during traversal are
not scanned. Explicit file arguments bypass ignore rules, but must still have a
supported extension. Results are deduplicated and sorted.

Ignored files and explicit overrides do not produce warnings.
