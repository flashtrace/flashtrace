# Basic tracing

The smallest complete flashtrace setup: one Markdown specification and one
TypeScript file covering it.

- [spec.md](spec.md) defines a titled requirement whose Needs list demands an
  implementation item.
- [login.ts](login.ts) provides that item with a tag in a line comment.

Running flashtrace in this directory reports a clean trace and exits with
code 0; with -v it lists the requirement, its need edge and the implementation
item that wants it.
