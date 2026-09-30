<script lang="ts">
  import { page } from '$app/state';
  import { formatBoughtOn, formatPrice } from '$lib/format';
  import type { AdminProductResponse, AdminProductsResponse } from '../../../../api/src/features/admin/products/contract/response';

  const LIMIT = 40;

  let { data } = $props();

  const q = $derived(page.url.searchParams.get('q') ?? '');
  const imported = $derived(Number.parseInt(page.url.searchParams.get('imported') ?? '', 10) || 0);
  const error = $derived(page.url.searchParams.get('error') ?? '');

  let more = $state<AdminProductResponse[]>([]);
  let moreQuery = $state<string | null>(null);
  let moreFull = $state(true);
  let moreError = $state('');
  let loading = $state(false);

  const products = $derived(moreQuery === q ? [...data.products, ...more] : data.products);
  const loadError = $derived(moreError || data.loadError);
  const hasMore = $derived(moreQuery === q ? moreFull && products.length > 0 : data.products.length === LIMIT);

  $effect(() => {
    void q;
    moreError = '';
  });

  async function loadMore() {
    if (loading || !hasMore) return;
    const query = q;
    const offset = products.length;
    loading = true;
    moreError = '';
    try {
      const params = new URLSearchParams({
        q: query,
        offset: String(offset),
        limit: String(LIMIT),
      });
      const res = await fetch(`/api/admin/products.json?${params}`);
      if (query !== q) return;
      if (!res.ok) {
        moreError = 'Could not load products.';
        return;
      }
      const body = (await res.json()) as AdminProductsResponse;
      if (query !== q) return;
      const seen = new Set((moreQuery === query ? [...data.products, ...more] : data.products).map((product) => product.id));
      const next = body.products.filter((product) => !seen.has(product.id));
      more = moreQuery === query ? [...more, ...next] : next;
      moreQuery = query;
      moreFull = body.products.length === LIMIT;
    } catch {
      if (query !== q) return;
      moreError = 'API is unavailable.';
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head>
  <title>Products · Bulkly</title>
</svelte:head>

{#if error}
  <p class="banner" role="alert">{error}</p>
{/if}
{#if imported > 0}
  <p class="banner">Saved {imported} purchase{imported === 1 ? '' : 's'} from the bill.</p>
{/if}
{#if loadError}
  <p class="banner" role="alert">{loadError}</p>
{/if}

<div class="toolbar">
  <form class="search" method="get" action="/admin">
    <label class="sr" for="q">Search</label>
    <input id="q" name="q" type="search" value={q} placeholder="Find a product" autocomplete="off" />
    <button type="submit" class="btn btn-tag">Search</button>
  </form>
</div>

{#if products.length === 0}
  {#if !loadError}
    <div class="empty">
      {#if q}
        <p>No product matches “{q}”.</p>
      {:else}
        <p>Nothing on the list yet.</p>
        <p><a href="/admin/products/new" data-sveltekit-reload>Add the first product you buy in bulk</a>, or <a href="/admin/receipts" data-sveltekit-reload>scan a bill</a>.</p>
      {/if}
    </div>
  {/if}
{:else}
  <ul class="ledger">
    {#each products as product (product.id)}
      <li>
        <a class="row" href="/admin/products/{product.id}" data-sveltekit-reload>
          {#if product.image}
            <img class="thumb" src={product.image} alt="" />
          {:else}
            <span class="thumb thumb-empty" aria-hidden="true"></span>
          {/if}
          <span class="row-main">
            <strong>{product.name}</strong>
            <span class="meta">{product.unitName}{product.lastBought ? ` · last ${formatBoughtOn(product.lastBought)}` : ''}</span>
          </span>
          <span class="row-amt">{product.price ? formatPrice(product.price, product.compareValue, product.unitName, data.currency) : '—'}</span>
        </a>
      </li>
    {/each}
  </ul>
  {#if hasMore}
    <div class="more">
      <button class="btn btn-plain" type="button" disabled={loading} onclick={loadMore}>
        {loading ? 'Loading…' : 'Load more'}
      </button>
    </div>
  {/if}
{/if}

<style>
  .more {
    margin-top: 1rem;
  }
</style>
