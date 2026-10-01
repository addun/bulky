<script lang="ts">
  import * as Alert from '$lib/components/ui/alert/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Empty from '$lib/components/ui/empty/index.js';
  import { formatBoughtOn, formatMoneyAmount, formatQty } from '$lib/format';
  import { resourceView, arr, num, obj, text } from '$lib/admin/view';

  let props = $props();
  const view = $derived(resourceView(props));
  const receipt = $derived(obj(view.receipt));
  const store = $derived(obj(view.store));
  const purchases = $derived(arr(view.purchases));
  const imported = $derived(num(view.imported));
  const symbol = $derived(text(view.page.symbol));
</script>

<h1 class="text-2xl font-semibold tracking-tight">Receipt</h1>

{#if imported > 0}
  <Alert.Root>
    <Alert.Description>Saved {imported} purchase{imported === 1 ? '' : 's'} from the bill.</Alert.Description>
  </Alert.Root>
{/if}
{#if view.notes}
  <Alert.Root>
    <Alert.Description>{text(view.notes)}</Alert.Description>
  </Alert.Root>
{/if}

<div class="grid items-start gap-6 lg:grid-cols-[16rem_1fr]">
  {#if receipt.imagePath}
    <img class="w-full rounded-xl border" src="/admin/receipts/{receipt.id}/preview" alt="Uploaded bill" />
  {/if}

  <div class="flex flex-col gap-4">
    <section class="flex flex-col gap-1">
      <div class="flex items-center justify-between gap-3">
        <h2 class="text-lg font-semibold tracking-tight">Visit</h2>
        <Button variant="outline" size="sm" href="/admin/receipts/{receipt.id}/edit">Edit</Button>
      </div>
      <p class="text-muted-foreground text-sm">
        {view.boughtOn ? formatBoughtOn(text(view.boughtOn)) : 'No date'}
        {num(store.id) ? ` · ${text(store.name)}` : ' · No store'}
      </p>
    </section>

    <h2 class="text-lg font-semibold tracking-tight">Products</h2>
    {#if purchases.length === 0}
      <Empty.Root class="border">
        <Empty.Header>
          <Empty.Title>No purchases left on this bill.</Empty.Title>
        </Empty.Header>
      </Empty.Root>
    {:else}
      <ul class="divide-y overflow-hidden rounded-xl border">
        {#each purchases as purchase (text(obj(purchase).id))}
          {@const row = obj(purchase)}
          <li class="flex flex-col gap-1 px-3 py-2">
            <a class="hover:bg-muted/50 -mx-3 flex items-center gap-3 px-3 py-1" href="/admin/products/{row.productId}">
              {#if row.imagePath}
                <img class="size-10 rounded-md object-cover" src="/images/{row.imagePath}" alt="" />
              {:else}
                <span class="bg-muted size-10 rounded-md" aria-hidden="true"></span>
              {/if}
              <span class="min-w-0 flex-1">
                <span class="block font-medium">{text(row.productName)}</span>
                <span class="text-muted-foreground text-sm">{formatQty(text(row.quantity))} {text(row.unitName)}</span>
              </span>
              <span class="text-sm tabular-nums">{formatMoneyAmount(text(row.amount), symbol)}</span>
            </a>
            <span class="text-right">
              <Button variant="ghost" size="sm" href="/admin/purchases/{row.id}/edit">Edit</Button>
              <Button variant="ghost" size="sm" class="text-destructive" href="/admin/purchases/{row.id}/delete">Delete</Button>
            </span>
          </li>
        {/each}
      </ul>
    {/if}

    <Button variant="destructive" class="w-fit" href="/admin/receipts/{receipt.id}/delete">Delete receipt</Button>
  </div>
</div>
