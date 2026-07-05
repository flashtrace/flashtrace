# Known limitations

- Comment detection is lexical: comment markers inside string literals (e.g. a URL containing `//`) are treated as comments.
- Only `#`-style Markdown headings are recognized as titles (no underlined headings).
