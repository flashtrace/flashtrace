# Known limitations

- Comment detection is lexical: comment markers inside string literals are treated as comments (e.g. a `#` in a Python string, or a `//` in a JS string inside an embedded `<script>`, can define a phantom item). URL-shaped text (a scheme followed by `://`) is exempt - markers inside a URL never open a comment - which conversely means a comment opener written directly against a `scheme://`-shaped token (e.g. `note://…` with no separating whitespace) is not recognized.
- A revision layer longer than 15 digits is outside the tool's numeric range: such layers may canonicalize differently than shorter ones, so revisions this long are unsupported.
