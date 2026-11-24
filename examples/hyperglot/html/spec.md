# HTML comment grammar

`req:html/grammar#1`

Markup comments by default, with script and style regions that switch grammar.

Covers: feat:support-grammar/html#1

Needs:
- req:html/htm#1
- req:html/html#1
- req:html/svelte#1
- req:html/vue#1

Tags: grammar, html

## .htm

`req:html/htm#1`

Needs:
- impl:html/htm-markup#1
- impl:html/htm-script-line#1
- impl:html/htm-script-block#1
- impl:html/htm-script-template#1
- impl:html/htm-style-block#1
- impl:html/htm-script-after-double-quoted#1
- impl:html/htm-script-after-single-quoted#1
- impl:html/htm-script-after-backtick-quoted#1
- impl:html/htm-style-after-double-quoted#1
- impl:html/htm-style-after-single-quoted#1

[req:html/htm#1 --> req:html/html#1]

## .html

`req:html/html#1`

Needs:
- impl:html/html-markup#1
- impl:html/html-script-line#1
- impl:html/html-script-block#1
- impl:html/html-script-template#1
- impl:html/html-style-block#1
- impl:html/html-script-after-double-quoted#1
- impl:html/html-script-after-single-quoted#1
- impl:html/html-script-after-backtick-quoted#1
- impl:html/html-style-after-double-quoted#1
- impl:html/html-style-after-single-quoted#1

## .svelte

`req:html/svelte#1`

Needs:
- impl:html/svelte-markup#1
- impl:html/svelte-script-line#1
- impl:html/svelte-script-block#1
- impl:html/svelte-script-coffee-line#1
- impl:html/svelte-script-coffee-block#1
- impl:html/svelte-style-block#1
- impl:html/svelte-style-scss-line#1
- impl:html/svelte-script-after-double-quoted#1
- impl:html/svelte-script-after-single-quoted#1
- impl:html/svelte-script-after-backtick-quoted#1
- impl:html/svelte-style-after-double-quoted#1
- impl:html/svelte-style-after-single-quoted#1
- impl:html/svelte-script-coffee-after-double-quoted#1
- impl:html/svelte-script-coffee-after-single-quoted#1
- impl:html/svelte-style-scss-after-double-quoted#1
- impl:html/svelte-style-scss-after-single-quoted#1

## .vue

`req:html/vue#1`

Needs:
- impl:html/vue-markup#1
- impl:html/vue-script-line#1
- impl:html/vue-script-block#1
- impl:html/vue-script-coffee-line#1
- impl:html/vue-script-coffee-block#1
- impl:html/vue-style-block#1
- impl:html/vue-style-scss-line#1
- impl:html/vue-script-after-double-quoted#1
- impl:html/vue-script-after-single-quoted#1
- impl:html/vue-script-after-backtick-quoted#1
- impl:html/vue-style-after-double-quoted#1
- impl:html/vue-style-after-single-quoted#1
- impl:html/vue-script-coffee-after-double-quoted#1
- impl:html/vue-script-coffee-after-single-quoted#1
- impl:html/vue-style-scss-after-double-quoted#1
- impl:html/vue-style-scss-after-single-quoted#1
