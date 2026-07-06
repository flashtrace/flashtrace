# Forwarding / delegation

```
[<source-id> --> <target-id>]
```

A forwarding tag redirects the coverage obligation of the source item to the target item: instead of having to satisfy its own `Needs`, the source counts as shallow-covered exactly when the target exists, and as deep-covered exactly when the target is deep-covered. Spaces around `-->` are optional.

```
[req:login#1 --> dsn:auth#2]
[req:login#1-->dsn:auth#2]
```

## Where it is recognized

- **Code files** - inside comments, like the other tags (see [Code tags](code-tags.md)). A forwarding tag defines no item and does not anchor `[>>…]` need tags.
- **Markdown files** - on a line containing nothing but the tag, optionally wrapped in backticks. It may appear anywhere, including inside an item's definition (there it is not part of the description).

A forwarding may be declared anywhere in the project; it does not have to sit next to the source item's definition.

## Rules

- The source ID must refer to an existing item; otherwise the forwarding is reported as a *problem* (with the usual revision-mismatch hint).
- If the target ID does not exist, the source item is *uncovered* (with the revision-mismatch hint).
- At most one forwarding per source ID; every further declaration flags the source item as *duplicate*. The first declaration stays in effect.
- Forwarding chains must be acyclic; a forwarding of an item to itself counts as a cycle too. Every forwarding on a cycle is reported as a *problem* and has no effect - the items on the cycle fall back to their own `Needs`.
- A forwarding target counts as demanded coverage: a code item referenced only as a forwarding target is not *unwanted*. Only a valid forwarding demands its target: one voided as invalid (non-existent source, cyclic chain) does not, so a code item referenced only by an invalid forwarding is flagged *unwanted* in addition to the *problem*.
- Forwarding only lifts the source's coverage obligation. Its literal `Needs` list still validates incoming `Covers` entries, and its own `Covers` entries are checked unchanged.
