<template>
  <!--
    [impl:html/vue-markup#1]
  -->
  <p>hyperglot fixture</p>
</template>

<script>
// [impl:html/vue-script-line#1]
/*
 * [impl:html/vue-script-block#1]
 */
const doubleQuoted = "\" // [impl:html/vue-script-ghost-double-quoted#1]"; // [impl:html/vue-script-after-double-quoted#1]
const singleQuoted = '\' // [impl:html/vue-script-ghost-single-quoted#1]'; // [impl:html/vue-script-after-single-quoted#1]
const backtickQuoted = `\` // [impl:html/vue-script-ghost-backtick-quoted#1]`; // [impl:html/vue-script-after-backtick-quoted#1]
export default {};
</script>

<script lang="coffee">
# [impl:html/vue-script-coffee-line#1]
doubleQuoted = "\" # [impl:html/vue-script-coffee-ghost-double-quoted#1]" # [impl:html/vue-script-coffee-after-double-quoted#1]
singleQuoted = '\' # [impl:html/vue-script-coffee-ghost-single-quoted#1]' # [impl:html/vue-script-coffee-after-single-quoted#1]
###
  [impl:html/vue-script-coffee-block#1]
###
</script>

<style>
/*
 * [impl:html/vue-style-block#1]
 */
.hyperglot-double-quoted::before { content: "\" /* [impl:html/vue-style-ghost-double-quoted#1]"; } /* [impl:html/vue-style-after-double-quoted#1] */
.hyperglot-single-quoted::before { content: '\' /* [impl:html/vue-style-ghost-single-quoted#1]'; } /* [impl:html/vue-style-after-single-quoted#1] */
.hyperglot { display: block; }
</style>

<style lang="scss">
// [impl:html/vue-style-scss-line#1]
$doubleQuoted: "\" // [impl:html/vue-style-scss-ghost-double-quoted#1]"; // [impl:html/vue-style-scss-after-double-quoted#1]
$singleQuoted: '\' // [impl:html/vue-style-scss-ghost-single-quoted#1]'; // [impl:html/vue-style-scss-after-single-quoted#1]
.hyperglot { .nested { display: block; } }
</style>
