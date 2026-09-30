<script lang="ts">
  let { children } = $props();
</script>

<header class="topbar">
  <div class="topbar-inner">
    <a class="topbar-admin" href="/admin">Panel</a>
  </div>
</header>
<main class="sheet">
  {@render children()}
</main>
