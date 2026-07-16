<template>
  <!-- [impl:web/markup#1] -->
  <section class="dashboard">
    <article v-for="m in metrics" :key="m.name">{{ m.name }}</article>
  </section>
</template>

<script>
// [impl:web/widget#1]
export default {
  name: 'Dashboard',
  data() {
    return { metrics: [] };
  },
};
</script>

<style>
/* [impl:web/theme#1] */
.dashboard {
  display: grid;
}
</style>
