# Known limitations

- Comment detection is lexical: comment markers inside string literals (e.g. a URL containing `//`) are treated as comments. This includes strings inside an embedded `<script>`, so a `//` in a JS string can define a phantom item.
- A few languages are scanned line-comment-only because their block-comment forms are not yet wired up: CoffeeScript (`### … ###`), Scheme/Racket (`#| … |#`), Julia (`#= … =#`) and Nim (`#[ … ]#`).
- Only `#`-style Markdown headings are recognized as titles (no underlined headings).
