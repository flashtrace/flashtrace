# Known limitations

- Comment detection is lexical: comment markers inside string literals (e.g. a URL containing `//`) are treated as comments. This includes strings inside an embedded `<script>`, so a `//` in a JS string can define a phantom item.
- In CoffeeScript, any `###` opens a block comment, while the language itself treats `###` followed by another `#` (e.g. a `#### Section` heading or a `##########` divider line) as a line comment - such a line can leave a block open and scan the following code as comment text.
- Only `#`-style Markdown headings are recognized as titles (no underlined headings).
