<script lang="ts">
  import { onMount } from 'svelte';

  type Suggestion = {
    id: number;
    name: string;
    unit: string;
    image: string;
    price?: string;
  };

  let query = $state('');
  let items = $state<Suggestion[]>([]);
  let error = $state('');
  let loading = $state(false);

  async function load(q: string) {
    loading = true;
    error = '';
    try {
      const res = await fetch(`/api/products/suggestions.json?q=${encodeURIComponent(q)}`);
      if (!res.ok) {
        error = 'Could not load suggestions.';
        items = [];
        return;
      }
      items = await res.json();
    } catch {
      error = 'API is not reachable.';
      items = [];
    } finally {
      loading = false;
    }
  }

  function onInput(event: Event) {
    const value = (event.currentTarget as HTMLInputElement).value;
    query = value;
    void load(value);
  }

  onMount(() => {
    void load('');
  });
</script>

<svelte:head>
  <title>Bulkly</title>
</svelte:head>

<section class="space-y-6">
  <div class="space-y-2">
    <h1 class="text-3xl font-semibold tracking-tight">Czy to promka</h1>
    <p class="max-w-xl text-muted">Search the catalog. This shell talks to the JSON API.</p>
  </div>

  <label class="block">
    <span class="sr-only">Search products</span>
    <input
      class="w-full rounded-md border border-line bg-sheet px-4 py-3 text-ink outline-none ring-pine placeholder:text-muted focus:ring-2"
      type="search"
      placeholder="bananas"
      value={query}
      oninput={onInput}
    />
  </label>

  {#if loading}
    <p class="text-sm text-muted">Loading…</p>
  {:else if error}
    <p class="text-sm text-danger">{error}</p>
  {:else if items.length === 0}
    <p class="text-sm text-muted">No matching products.</p>
  {:else}
    <ul class="divide-y divide-line overflow-hidden rounded-md border border-line bg-sheet">
      {#each items as item (item.id)}
        <li class="flex items-center justify-between gap-4 px-4 py-3">
          <span class="font-medium">{item.name}</span>
          <span class="text-sm text-muted">{item.price ?? item.unit}</span>
        </li>
      {/each}
    </ul>
  {/if}
</section>
