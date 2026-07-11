# Code tags

Tags are written inside comments. The comment style is chosen per file extension, so the same tag syntax works across many languages. Multi-line comment blocks are supported; each tag may sit on its own line inside a block.

| Comment family | Line | Block | Extensions |
|---|---|---|---|
| C-like | `//` | `/* … */` | `.ts` `.js` `.mjs` `.cjs` `.jsx` `.tsx` `.cts` `.mts` `.c` `.h` `.cpp` `.cc` `.hpp` `.cs` `.java` `.go` `.rs` `.swift` `.kt` `.kts` `.scala` `.dart` `.php` `.proto` `.scss` `.less` |
| Hash | `#` | – | `.py` `.rb` `.sh` `.bash` `.zsh` `.yaml` `.yml` `.toml` `.r` `.pl` `.pm` |
| PowerShell | `#` | `<# … #>` | `.ps1` `.psm1` |
| SQL | `--` | `/* … */` | `.sql` |
| Lua | `--` | `--[[ … ]]` | `.lua` |
| Haskell | `--` | `{- … -}` | `.hs` |
| CSS | – | `/* … */` | `.css` |
| HTML/XML | – | `<!-- … -->` | `.xml` `.svg` |
| HTML + embedded | – | `<!-- … -->` (markup) | `.html` `.htm` `.vue` `.svelte` |

HTML-family files switch comment style by region: `<!-- … -->` in markup, C-like comments (`//`, `/* … */`) inside `<script>`, and CSS comments (`/* … */`) inside `<style>`. So a `//` in template text or a URL is *not* treated as a comment - only a real HTML comment is.

- `[<type>:[<group>/…]<name>#<revision>]` - defines a coverage item with that ID. It satisfies every `Needs` entry (anywhere in the project) that names this exact ID.
- `[>><type>:[<group>/…]<name>#<revision>]` - attaches a need to the *nearest preceding* item tag in the **same file**. If no item tag precedes it, this is reported as an error.
- `[<source-id> >> <target-id>]` - attaches the need `<target-id>` to the *preceding item tag with exactly* `<source-id>` in the **same file** (spaces around `>>` optional). If no such item tag precedes it, this is reported as an error. Unlike the implicit form, it stays attached to its item even when another item tag is later inserted in between.

The need target of either form may use a [wildcard revision](revisions.md#wildcard-revisions) (e.g. `[>>utest:auth/login#2.x]`); the item tag and the `<source-id>` anchor must name a concrete revision.
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

Files ignored by git are excluded from scanning (`git ls-files --cached --others --exclude-standard`; a plain directory walk skipping `.git`/`node_modules` is used outside a git repository).
