# Known limitations

- Comment detection is lexical: comment markers inside string literals (e.g. a URL containing `//`) are treated as comments. This includes strings inside an embedded `<script>`, so a `//` in a JS string can define a phantom item.
- In CoffeeScript, any `###` opens a block comment, while the language itself treats `###` followed by another `#` (e.g. a `#### Section` heading or a `##########` divider line) as a line comment - such a line can leave a block open and scan the following code as comment text.
- Setext heading text never carries a `|`. CommonMark allows pipes in the paragraph line above an underline; the tracer reads any pipe-carrying line as a table row - the row wins over the heading, so a table entry directly above an underline stays in its table instead of becoming a title. A heading whose text contains a pipe must be written ATX-style (`#`).
