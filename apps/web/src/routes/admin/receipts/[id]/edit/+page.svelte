<script lang="ts">
  import Notice from '$lib/admin/Notice.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Field from '$lib/components/ui/field/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import * as NativeSelect from '$lib/components/ui/native-select/index.js';
  import { toDatetimeLocal } from '$lib/format';
  import { resourceView, arr, num, obj, text } from '$lib/admin/view';
  let { data, form } = $props();
  const props = $derived({
    receipt: data.receipt,
    boughtOn: form?.boughtOn ?? data.boughtOn,
    store: form?.store ?? data.store,
    stores: data.stores,
  });

  const view = $derived(resourceView(props));
  const receipt = $derived(obj(view.receipt));
  const store = $derived(obj(view.store));
  const stores = $derived(arr(view.stores).map(obj));
</script>

<svelte:head><title>Edit visit · Bulkly</title></svelte:head>

<Notice message={form?.message} />
<div class="flex flex-col gap-1">
  <h1 class="text-2xl font-semibold tracking-tight">Edit visit</h1>
  <p class="text-muted-foreground">Date and store for this bill.</p>
  <p class="text-muted-foreground text-sm">Saving applies these values to every product assigned to this receipt.</p>
</div>

<form method="post" action="/admin/receipts/{receipt.id}/edit">
  <Field.Group class="max-w-xl">
    <Field.Set>
      <Field.Legend>When</Field.Legend>
      <Field.Field>
        <Field.Label for="bought-on">Date and hour <span class="text-destructive">*</span></Field.Label>
        <Input id="bought-on" type="datetime-local" name="bought_on" required value={toDatetimeLocal(text(view.boughtOn))} />
      </Field.Field>
    </Field.Set>

    <Field.Set>
      <Field.Legend>Store</Field.Legend>
      <Field.Field>
        <Field.Label for="store">Store</Field.Label>
        <NativeSelect.Root id="store" class="w-full" name="store_id" value={num(store.id) ? text(store.id) : ''}>
          <NativeSelect.Option value="">None</NativeSelect.Option>
          {#each stores as row (text(row.id))}
            <NativeSelect.Option value={text(row.id)}>{text(row.label)}</NativeSelect.Option>
          {/each}
        </NativeSelect.Root>
      </Field.Field>
      {#if stores.length === 0}<Field.Description>No stores yet. You can still save, or <a href="/admin/stores/new">add a store</a> first.</Field.Description>{/if}
    </Field.Set>

    <div class="flex flex-wrap items-center gap-2">
      <Button type="submit">Save visit</Button>
      <Button variant="outline" href="/admin/receipts/{receipt.id}">Cancel</Button>
    </div>
  </Field.Group>
</form>
<Button variant="destructive" class="w-fit" href="/admin/receipts/{receipt.id}/delete">Delete receipt</Button>
