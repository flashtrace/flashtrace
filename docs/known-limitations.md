# Known limitations

- Comment detection is lexical: comment markers inside string literals (e.g. a URL containing `//`) are treated as comments. This includes strings inside an embedded `<script>`, so a `//` in a JS string can define a phantom item.
- HTML `<script>`/`<style>` regions terminate lexically *by design*: the first `</script>`/`</style>` ends the region regardless of surrounding JS strings or comments. This matches how browsers tokenize raw-text elements - a literal `</script>` inside a string genuinely ends the script - so authors escape it as `<\/script>`, which flashtrace also leaves intact.
- The `lang`/`type` attribute on `<script>`/`<style>` is ignored: contents are always scanned with C-like comments. So `type="application/json"` (no comments), `type="text/x-template"` (HTML), and `lang="scss"` (adds `//`) are scanned with the wrong grammar.
- Only `#`-style Markdown headings are recognized as titles (no underlined headings).
