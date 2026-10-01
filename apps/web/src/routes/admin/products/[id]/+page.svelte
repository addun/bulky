<script lang="ts">
  import Notice from '$lib/admin/Notice.svelte';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Card from '$lib/components/ui/card/index.js';
  import * as Empty from '$lib/components/ui/empty/index.js';
  import { formatBoughtOn, formatLinePrice, formatMoneyAmount, formatQty } from '$lib/format';
  import { resourceView, arr, obj, text } from '$lib/admin/view';
  let { data } = $props();
  const props = $derived({
    product: data.product,
    groups: data.groups,
    purchases: data.purchases,
    storeById: data.storeById,
    symbol: data.symbol,
  });

  const view = $derived(resourceView(props));
  const product = $derived(obj(view.product));
  const groups = $derived(arr(view.groups));
  const purchases = $derived(arr(view.purchases));
  const stores = $derived(obj(view.storeById));
  const symbol = $derived(text(view.page.symbol));

  function storeName(id: unknown): string {
    if (id === null || id === undefined || id === '') return '';
    return text(obj(stores[String(id)]).name);
  }
</script>

<svelte:head><title>{data.product.name} · Bulkly</title></svelte:head>

<Notice message={data.error} />
<div class="flex flex-col gap-8">
  <div class="flex flex-wrap items-start gap-4">
    {#if product.imagePath}
      <img class="size-24 rounded-xl object-cover" src="/images/{product.imagePath}" alt="" />
    {:else}
      <span class="bg-muted size-24 rounded-xl" aria-hidden="true"></span>
    {/if}
    <div class="flex flex-col gap-2">
      <h1 class="text-2xl font-semibold tracking-tight">{text(product.name)}</h1>
      {#if product.ean}<p class="text-muted-foreground text-sm">EAN {text(product.ean)}</p>{/if}
      <div class="flex flex-wrap gap-2">
        <Button href="/admin/products/{product.id}/purchases/new">Add</Button>
        <Button variant="outline" href="/admin/products/{product.id}/edit">Edit</Button>
        <Button variant="outline" href="/admin/aliases?product={product.id}">Aliases</Button>
      </div>
    </div>
  </div>

  <section class="flex flex-col gap-3">
    <h2 class="text-lg font-semibold tracking-tight">Comparison groups</h2>
    {#if groups.length === 0}
      <Empty.Root class="border">
        <Empty.Header>
          <Empty.Description>Not in any comparison group. <a href="/admin/products/{product.id}/edit">Edit</a> to assign one.</Empty.Description>
        </Empty.Header>
      </Empty.Root>
    {:else}
      <ul class="divide-y overflow-hidden rounded-xl border">
        {#each groups as group (text(obj(group).id))}
          {@const row = obj(group)}
          <li class="flex items-center justify-between gap-3 px-3 py-2">
            <span>
              <span class="font-medium">{text(row.name)}</span>
              <span class="text-muted-foreground block text-sm">{text(row.unitName)}</span>
            </span>
            <Button variant="ghost" size="sm" href="/admin/comparison-groups/{row.id}/edit">Edit</Button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="flex flex-col gap-3">
    <h2 class="text-lg font-semibold tracking-tight">History</h2>
    {#if purchases.length === 0}
      <Empty.Root class="border">
        <Empty.Header>
          <Empty.Title>Nothing logged yet.</Empty.Title>
        </Empty.Header>
      </Empty.Root>
    {:else}
      <div class="flex flex-col gap-3">
        {#each purchases as purchase (text(obj(purchase).id))}
          {@const row = obj(purchase)}
          {@const shop = storeName(row.storeId)}
          <Card.Root>
            <Card.Header>
              <Card.Title>
                {formatBoughtOn(text(row.boughtOn))}
                {#if row.isPrice}<Badge variant="outline">price</Badge>{/if}
              </Card.Title>
              <Card.Description>
                {#if shop}{shop} · {/if}{formatQty(text(row.quantity))} {text(product.unitName)} · {formatLinePrice(text(row.amount), text(row.quantity), text(product.compareValue), text(product.unitName), symbol)}
              </Card.Description>
              <Card.Action class="font-medium tabular-nums">{formatMoneyAmount(text(row.amount), symbol)}</Card.Action>
            </Card.Header>
            <Card.Footer class="justify-between">
              {#if row.receiptId}
                <Button variant="link" class="h-auto px-0" href="/admin/receipts/{row.receiptId}">Receipt {row.receiptId}</Button>
              {:else}
                <span class="text-muted-foreground text-sm">No receipt</span>
              {/if}
              <span>
                <Button variant="ghost" size="sm" href="/admin/purchases/{row.id}/edit">Edit</Button>
                <Button variant="ghost" size="sm" class="text-destructive" href="/admin/purchases/{row.id}/delete">Delete</Button>
              </span>
            </Card.Footer>
          </Card.Root>
        {/each}
      </div>
    {/if}
  </section>

  <div class="flex flex-wrap gap-2">
    <Button variant="outline" href="/admin/products/{product.id}/merge-with">Merge</Button>
    <Button variant="destructive" href="/admin/products/{product.id}/delete">Delete product</Button>
  </div>
</div>
