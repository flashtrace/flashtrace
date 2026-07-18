# Basic tracing

The smallest complete flashtrace setup: one Markdown specification and the
TypeScript files covering it.

- [spec.md](spec.md) defines a titled requirement whose Needs list demands an
  implementation item by its full ID and a unit test via the short-form need
  `utest#1`, which stands for `utest:auth/login#1` - the requirement's own
  `[group/]name` in the demanded type.
- [login.ts](login.ts) provides the implementation item with a tag in a line
  comment.
- [login.spec.ts](login.spec.ts) provides the unit-test item the short-form
  need resolves to.

Running flashtrace in this directory reports a clean trace and exits with
code 0; with -v it lists the requirement, its need edges and the items that
want them.
