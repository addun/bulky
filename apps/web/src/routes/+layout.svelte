<script lang="ts">
  let { children } = $props();
  const legacy = import.meta.env.DEV ? 'http://127.0.0.1:8080' : '';
</script>

<header class="topbar">
  <div class="topbar-inner">
    <a class="topbar-admin" href="{legacy}/admin">Panel</a>
  </div>
</header>
<main class="sheet">
  {@render children()}
</main>
