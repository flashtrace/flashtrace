# Known limitations

- Comment detection is lexical: comment markers inside string literals are treated as comments (e.g. a `#` in a Python string, or a `//` in a JS string inside an embedded `<script>`, can define a phantom item). URL-shaped text (a scheme followed by `://`) is exempt - markers inside a URL never open a comment - which conversely means a comment opener written directly against a `scheme://`-shaped token (e.g. `note://…` with no separating whitespace) is not recognized.
- In CoffeeScript, any `###` opens a block comment, while the language itself treats `###` followed by another `#` (e.g. a `#### Section` heading or a `##########` divider line) as a line comment - such a line can leave a block open and scan the following code as comment text.
