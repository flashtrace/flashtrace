# Known limitations

- Comment detection is lexical: comment markers inside string literals (e.g. a URL containing `//`) are treated as comments. This includes strings inside an embedded `<script>`, so a `//` in a JS string can define a phantom item.
- The `lang`/`type` attribute on `<script>`/`<style>` is ignored: contents are always scanned with C-like comments. So `type="application/json"` (no comments), `type="text/x-template"` (HTML), and `lang="scss"` (adds `//`) are scanned with the wrong grammar.
- Only `#`-style Markdown headings are recognized as titles (no underlined headings).
