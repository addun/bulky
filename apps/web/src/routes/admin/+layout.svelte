<script lang="ts">
  let { children } = $props();
</script>


<input class="nav-open" id="nav-open" type="checkbox" />
<header class="topbar">
  <div class="topbar-inner">
    <label class="nav-toggle" for="nav-open" aria-label="Open menu">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M4 7h16M4 12h16M4 17h16" /></svg>
    </label>
    <a class="wordmark" href="/">Bulkly</a>
  </div>
</header>
<label class="nav-backdrop" for="nav-open" aria-hidden="true"></label>
<aside class="rail">
  <a class="wordmark" href="/">Bulkly</a>
  <nav>
    <details class="nav-group" open>
      <summary>
        <svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M4 8.2 12 4l8 4.2v9.6L12 22 4 17.8zM12 12.2V22M4 8.2l8 4 8-4" /></svg>
        Catalog
        <svg class="nav-group-arrow" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="m8 10 4 4 4-4" /></svg>
      </summary>
      <a href="/admin">Products</a>
      <a href="/admin/units" data-sveltekit-reload>Units</a>
      <a href="/admin/aliases" data-sveltekit-reload>Aliases</a>
      <a href="/admin/comparison-groups" data-sveltekit-reload>Comparison groups</a>
    </details>
    <a href="/admin/receipts" data-sveltekit-reload>
      <svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M7 3.5h10v17l-1.6-1.1-1.6 1.1-1.6-1.1-1.6 1.1-1.6-1.1-1.6 1.1zM9 8h6M9 12h6M9 16h3.5" /></svg>
      Receipts
    </a>
    <details class="nav-group" open>
      <summary>
        <svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M4.5 20.5h15v-9.5l-7.5-5-7.5 5zM10 20.5v-6h4v6M8 11.5h.5M12 11.5h.5M16 11.5h.5" /></svg>
        Shops
        <svg class="nav-group-arrow" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="m8 10 4 4 4-4" /></svg>
      </summary>
      <a href="/admin/retail-chains" data-sveltekit-reload>Retail chains</a>
      <a href="/admin/stores" data-sveltekit-reload>Stores</a>
    </details>
    <a href="/admin/settings" data-sveltekit-reload>
      <svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M4.5 7h15M7 7a2.2 2.2 0 1 0 0-4.4A2.2 2.2 0 0 0 7 7zM4.5 17h15M17 17a2.2 2.2 0 1 0 0-4.4A2.2 2.2 0 0 0 17 17z" /></svg>
      Settings
    </a>
    <a class="nav-add" href="/admin/products/new" data-sveltekit-reload>
      <svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M12 5v14M5 12h14" /></svg>
      Add product
    </a>
  </nav>
</aside>
<main class="sheet">
  {@render children()}
</main>
