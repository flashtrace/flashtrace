<script>
// [impl:html/svelte-script-line#1]
/*
 * [impl:html/svelte-script-block#1]
 */
export default {};
</script>

<script type="application/json">
{ "note": "no comment grammar applies here, so [impl:html/none#1] stays data" }
</script>

<script type="text/html">
  <!-- [impl:html/svelte-script-template#1] -->
  <li>inline template</li>
</script>

<script lang="coffee">
# [impl:html/svelte-script-coffee-line#1]
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
.hyperglot { display: block; }
</style>

<style lang="scss">
// [impl:html/svelte-style-scss-line#1]
.hyperglot { .nested { display: block; } }
</style>
