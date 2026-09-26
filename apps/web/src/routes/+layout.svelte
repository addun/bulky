<script lang="ts">
  import '../app.css';
  let { children } = $props();
</script>

<div class="min-h-screen bg-paper text-ink">
  <header class="border-b border-line bg-sheet">
    <div class="mx-auto flex max-w-3xl items-baseline justify-between px-6 py-5">
      <a href="/" class="text-lg font-semibold tracking-tight">Bulkly</a>
      <p class="text-sm text-muted">local price log</p>
    </div>
  </header>
  <main class="mx-auto max-w-3xl px-6 py-10">
    {@render children()}
  </main>
</div>
