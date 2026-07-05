# Code tags (`.ts`, `.js`, `.mjs`, `.sql`, `.vue`)

Tags are written inside comments — `//`, `/* … */`, `<!-- … -->` (Vue), or `--` (SQL). Multi-line comment blocks are supported; each tag may sit on its own line inside a block.

- `[<type>:[<group>/…]<name>#<revision>]` — defines a coverage item with that ID. It satisfies every `Needs` entry (anywhere in the project) that names this exact ID.
- `[>><type>:[<group>/…]<name>#<revision>]` — attaches a need to the *nearest preceding* item tag in the **same file**. If no item tag precedes it, this is reported as an error.

```ts
// [impl:auth/login#1]
// [>>utest:auth/login#1]
export function login(token: SessionToken) { … }
```

Files ignored by git are excluded from scanning (`git ls-files --cached --others --exclude-standard`; a plain directory walk skipping `.git`/`node_modules` is used outside a git repository).
