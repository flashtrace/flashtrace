# Known limitations

- Comment detection is lexical: comment markers inside string literals (e.g. a URL containing `//`) are treated as comments. This includes strings inside an embedded `<script>`, so a `//` in a JS string can define a phantom item.
- In CoffeeScript, any `###` opens a block comment, while the language itself treats `###` followed by another `#` (e.g. a `#### Section` heading or a `##########` divider line) as a line comment - such a line can leave a block open and scan the following code as comment text.
- The table tracking behind the item-placement diagnostics ends a table at a blank line or a heading. GFM additionally breaks a table at other block starts (a fenced code block, a blockquote, a thematic break); flashtrace still counts such lines as table rows, so an ID line directly after one of them - inside what GFM considers an already ended table - is reported as absorbed although the page renders it on its own.
