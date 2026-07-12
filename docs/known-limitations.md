# Known limitations

- Comment detection is lexical: comment markers inside string literals (e.g. a URL containing `//`) are treated as comments. This includes strings inside an embedded `<script>`, so a `//` in a JS string can define a phantom item.
- Only `#`-style Markdown headings are recognized as titles (no underlined headings).
