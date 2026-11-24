<script>
// [impl:html/svelte-script-line#1]
/*
 * [impl:html/svelte-script-block#1]
 */
const doubleQuoted = "\" // [impl:html/svelte-script-ghost-double-quoted#1]"; // [impl:html/svelte-script-after-double-quoted#1]
const singleQuoted = '\' // [impl:html/svelte-script-ghost-single-quoted#1]'; // [impl:html/svelte-script-after-single-quoted#1]
const backtickQuoted = `\` // [impl:html/svelte-script-ghost-backtick-quoted#1]`; // [impl:html/svelte-script-after-backtick-quoted#1]
export default {};
</script>

<script lang="coffee">
# [impl:html/svelte-script-coffee-line#1]
doubleQuoted = "\" # [impl:html/svelte-script-coffee-ghost-double-quoted#1]" # [impl:html/svelte-script-coffee-after-double-quoted#1]
singleQuoted = '\' # [impl:html/svelte-script-coffee-ghost-single-quoted#1]' # [impl:html/svelte-script-coffee-after-single-quoted#1]
###
  [impl:html/svelte-script-coffee-block#1]
###
</script>

  <!--
    [impl:html/svelte-markup#1]
  -->
  <p>hyperglot fixture</p>

<style>
/*
 * [impl:html/svelte-style-block#1]
 */
.hyperglot-double-quoted::before { content: "\" /* [impl:html/svelte-style-ghost-double-quoted#1]"; } /* [impl:html/svelte-style-after-double-quoted#1] */
.hyperglot-single-quoted::before { content: '\' /* [impl:html/svelte-style-ghost-single-quoted#1]'; } /* [impl:html/svelte-style-after-single-quoted#1] */
.hyperglot { display: block; }
</style>

<style lang="scss">
// [impl:html/svelte-style-scss-line#1]
$doubleQuoted: "\" // [impl:html/svelte-style-scss-ghost-double-quoted#1]"; // [impl:html/svelte-style-scss-after-double-quoted#1]
$singleQuoted: '\' // [impl:html/svelte-style-scss-ghost-single-quoted#1]'; // [impl:html/svelte-style-scss-after-single-quoted#1]
.hyperglot { .nested { display: block; } }
</style>
