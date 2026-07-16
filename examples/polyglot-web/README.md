# Polyglot web project

Markdown items covered by code tags across several languages: TypeScript,
Python, SQL, plain HTML and a Vue single-file component with distinct markup,
script and style regions.

- The dashboard requirement in [spec.md](spec.md) collects its needs and its
  tag from a keyword table; the other items use plain keyword lines.
- Comment styles follow the language: line comments in [metrics.ts](metrics.ts),
  [test_metrics.py](test_metrics.py) and [aggregation.sql](aggregation.sql), an
  HTML comment in [index.html](index.html) (where a // inside markup text, like
  the URL there, is not a comment), and region-appropriate comments in
  [dashboard.vue](dashboard.vue): an HTML comment in the template, a // line
  comment in the script block and a CSS block comment in the style block.
- Items are tagged web, data or guide. Running with -t web,data drops the two
  guide items - a self-contained Markdown pair - while code items are always
  kept, so the filtered trace stays clean.

Both the unfiltered and the filtered run exit with code 0.
