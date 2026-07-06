# Code tags (`.ts`, `.js`, `.mjs`, `.sql`, `.vue`)

Tags are written inside comments - `//`, `/* … */`, `<!-- … -->` (Vue), or `--` (SQL). Multi-line comment blocks are supported; each tag may sit on its own line inside a block.

- `[<type>:[<group>/…]<name>#<revision>]` - defines a coverage item with that ID. It satisfies every `Needs` entry (anywhere in the project) that names this exact ID.
- `[>><type>:[<group>/…]<name>#<revision>]` - attaches a need to the *nearest preceding* item tag in the **same file**. If no item tag precedes it, this is reported as an error.
- `[<source-id> >> <target-id>]` - attaches the need `<target-id>` to the *preceding item tag with exactly* `<source-id>` in the **same file** (spaces around `>>` optional). If no such item tag precedes it, this is reported as an error. Unlike the implicit form, it stays attached to its item even when another item tag is later inserted in between.
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
  // [impl:auth/login#1>>impl:auth/session#1]
  return openSession(token);
}
```

Neither need form defines an item or moves the anchor of later `[>>…]` tags.

Files ignored by git are excluded from scanning (`git ls-files --cached --others --exclude-standard`; a plain directory walk skipping `.git`/`node_modules` is used outside a git repository).
