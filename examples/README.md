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

The end-to-end suite (`test/e2e.test.mjs`) runs every example and verifies
its report byte-for-byte against the snapshots in [test/e2e/](../test/e2e/),
so the exact output flashtrace prints for each example can be read there.
