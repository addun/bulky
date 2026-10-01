<script lang="ts">
  import { page } from '$app/state';
  import * as Alert from '$lib/components/ui/alert/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Empty from '$lib/components/ui/empty/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { formatBoughtOn, formatPrice } from '$lib/format';
  import type { AdminProductResponse, AdminProductsResponse } from '../../../../../api/src/features/admin/products/contract/response';

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
  <Alert.Root variant="destructive">
    <Alert.Description>{error}</Alert.Description>
  </Alert.Root>
{/if}
{#if imported > 0}
  <Alert.Root>
    <Alert.Description>Saved {imported} purchase{imported === 1 ? '' : 's'} from the bill.</Alert.Description>
  </Alert.Root>
{/if}
{#if loadError}
  <Alert.Root variant="destructive">
    <Alert.Description>{loadError}</Alert.Description>
  </Alert.Root>
{/if}

<div class="flex flex-col gap-4">
  <h1 class="text-2xl font-semibold tracking-tight">Products</h1>
  <form class="flex gap-2" method="get" action="/admin">
    <label class="sr-only" for="q">Search</label>
    <Input id="q" name="q" type="search" class="max-w-sm" value={q} placeholder="Find a product" autocomplete="off" />
    <Button type="submit">Search</Button>
  </form>
</div>

{#if products.length === 0}
  {#if !loadError}
    <Empty.Root class="border">
      <Empty.Header>
        {#if q}
          <Empty.Title>No product matches “{q}”.</Empty.Title>
        {:else}
          <Empty.Title>Nothing on the list yet.</Empty.Title>
          <Empty.Description>
            <a href="/admin/products/new">Add the first product you buy in bulk</a>, or <a href="/admin/receipts">scan a bill</a>.
          </Empty.Description>
        {/if}
      </Empty.Header>
    </Empty.Root>
  {/if}
{:else}
  <ul class="divide-y overflow-hidden rounded-xl border">
    {#each products as product (product.id)}
      <li>
        <a class="hover:bg-muted/50 flex items-center gap-3 px-3 py-2" href="/admin/products/{product.id}">
          {#if product.image}
            <img class="size-10 rounded-md object-cover" src={product.image} alt="" />
          {:else}
            <span class="bg-muted size-10 rounded-md" aria-hidden="true"></span>
          {/if}
          <span class="min-w-0 flex-1">
            <span class="block truncate font-medium">{product.name}</span>
            <span class="text-muted-foreground block text-sm">{product.unitName}{product.lastBought ? ` · last ${formatBoughtOn(product.lastBought)}` : ''}</span>
          </span>
          <span class="text-sm tabular-nums">{product.price ? formatPrice(product.price, product.compareValue, product.unitName, data.currency) : '—'}</span>
        </a>
      </li>
    {/each}
  </ul>
  {#if hasMore}
    <Button variant="outline" type="button" disabled={loading} onclick={loadMore}>
      {loading ? 'Loading…' : 'Load more'}
    </Button>
  {/if}
{/if}
