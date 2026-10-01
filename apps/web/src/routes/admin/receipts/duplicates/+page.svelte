<script lang="ts">
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Empty from '$lib/components/ui/empty/index.js';
  import { formatBoughtOn } from '$lib/format';
  import { resourceView, arr, obj, text } from '$lib/admin/view';
  let { data } = $props();
  const props = $derived({
    groups: data.groups,
  });

  const view = $derived(resourceView(props));
  const groups = $derived(arr(view.groups));
</script>

<svelte:head><title>Duplicate receipts · Bulkly</title></svelte:head>
<div class="flex flex-col gap-2">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <h1 class="text-2xl font-semibold tracking-tight">Duplicate receipts</h1>
    <Button variant="outline" href="/admin/receipts">Receipts</Button>
  </div>
  <p class="text-muted-foreground">Receipts from the same shop at the same time.</p>
</div>

{#if groups.length === 0}
  <Empty.Root class="border">
    <Empty.Header>
      <Empty.Title>No duplicates.</Empty.Title>
    </Empty.Header>
  </Empty.Root>
{:else}
  {#each groups as group, index (index)}
    {@const row = obj(group)}
    <section class="flex flex-col gap-2">
      <h2 class="text-lg font-semibold tracking-tight">{row.shopName ? text(row.shopName) : 'Unknown shop'} · {formatBoughtOn(text(row.boughtOn))}</h2>
      <p class="text-muted-foreground text-sm">{text(row.count)} receipts</p>
      <ul class="divide-y overflow-hidden rounded-xl border">
        {#each arr(row.receipts) as receipt (text(obj(receipt).id))}
          {@const item = obj(receipt)}
          <li>
            <a class="hover:bg-muted/50 block px-3 py-2" href="/admin/receipts/{item.id}">
              <span class="block font-medium">{item.shopName ? text(item.shopName) : formatBoughtOn(text(item.displayDate))}</span>
              <span class="text-muted-foreground text-sm">{item.shopName ? `${formatBoughtOn(text(item.displayDate))} · ` : ''}{text(item.statusLabel)}</span>
            </a>
          </li>
        {/each}
      </ul>
    </section>
  {/each}
{/if}
