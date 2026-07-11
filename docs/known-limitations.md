# Known limitations

- Comment detection is lexical: comment markers inside string literals (e.g. a URL containing `//`) are treated as comments.
- HTML `<script>`/`<style>` region boundaries are detected lexically too: a `</script>` inside a script string still ends the region, and a `lang`/`type` attribute on `<script>` is ignored (script contents are always scanned with C-like comments).
- Only `#`-style Markdown headings are recognized as titles (no underlined headings).
