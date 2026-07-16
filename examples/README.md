# Example projects

Each directory is a self-contained project traceable with a plain
`flashtrace` run; its README states what it demonstrates.

- [basic](basic/) - the smallest complete setup: one Markdown requirement
  covered by one TypeScript item tag.
- [revisions-and-forwarding](revisions-and-forwarding/) - exact multi-layer
  revisions, wildcard needs and a forwarding chain.
- [polyglot-web](polyglot-web/) - keyword tables, tag filtering and code tags
  across TypeScript, Python, SQL, HTML and Vue.
- [diagnostics](diagnostics/) - an intentionally defective project showing
  every defect and problem kind flashtrace reports.

[expected/](expected/) is not an example: it holds the exact report flashtrace
prints for each example and run variant (default, verbose, tag-filtered).
The end-to-end suite (`test/e2e.test.mjs`) verifies every example against
these files byte-for-byte, so they are guaranteed current - and double as a
reference for what flashtrace output looks like.
