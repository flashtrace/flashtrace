# Basic tracing

The smallest complete flashtrace setup: one Markdown specification and the
TypeScript files covering it.

- [spec.md](spec.md) defines a titled requirement whose Needs list demands its
  coverage with two short-form needs. `impl` names the implementation of the
  requirement's own `[group/]name` at its own revision - `impl:auth/login#1`;
  `utest#1` keeps the name but states the revision - `utest:auth/login#1`. A
  short form completes whatever it omits from the item stating it.
- [login.ts](login.ts) provides the implementation item with a tag in a line
  comment.
- [login.spec.ts](login.spec.ts) provides the unit-test item the short-form
  need resolves to.

Running flashtrace in this directory reports a clean trace and exits with
code 0; with -v it lists the requirement, its need edges and the items that
want them.
