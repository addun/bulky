<script lang="ts">
  import Notice from '$lib/admin/Notice.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Field from '$lib/components/ui/field/index.js';
  import * as NativeSelect from '$lib/components/ui/native-select/index.js';
  import { formatQty } from '$lib/format';
  import { resourceView, arr, num, obj, text } from '$lib/admin/view';
  let { data, form } = $props();
  const props = $derived({
    product: data.product,
    history: data.history,
    newUnitId: form?.newUnitId ?? 0,
  });

  const view = $derived(resourceView(props));
  const product = $derived(obj(view.product));
  const conversions = $derived(arr(product.conversions).map(obj));
  const history = $derived(num(view.history));
  let unitId = $state('');

  $effect(() => {
    unitId = text(view.newUnitId);
  });

  const picked = $derived(conversions.find((row) => text(row.unitId) === unitId));
</script>

<svelte:head><title>Change unit · Bulkly</title></svelte:head>

<Notice message={form?.message} />
<div class="flex max-w-xl flex-col gap-4">
  <h1 class="text-2xl font-semibold tracking-tight">Change unit for {text(product.name)}</h1>
  {#if conversions.length === 0}
    <p class="text-muted-foreground">Add a conversion first, then you can make that unit the purchase unit.</p>
    <div class="flex flex-wrap gap-2">
      <Button href="/admin/products/{product.id}/edit">Edit conversions</Button>
      <Button variant="outline" href="/admin/products/{product.id}">Cancel</Button>
    </div>
  {:else}
    {#if history}
      <p class="text-muted-foreground">This converts {history} logged buy{history === 1 ? '' : 's'} using the extra unit's factor.</p>
    {/if}
    <form method="post" action="/admin/products/{product.id}/change-unit">
      <Field.Group>
        <Field.Field>
          <Field.Label for="unit">New unit <span class="text-destructive">*</span></Field.Label>
          <NativeSelect.Root id="unit" class="w-full" name="unit_id" required bind:value={unitId}>
            <NativeSelect.Option value="">Select…</NativeSelect.Option>
            {#each conversions as row (text(row.unitId))}
              <NativeSelect.Option value={text(row.unitId)}>{text(row.unitName)}</NativeSelect.Option>
            {/each}
          </NativeSelect.Root>
        </Field.Field>
        <p class="text-sm">1 {text(product.unitName)} equals {picked ? formatQty(text(picked.factor)) : ''} {picked ? text(picked.unitName) : 'new unit'}</p>
        <div class="flex flex-wrap items-center gap-2">
          <Button type="submit">Change unit</Button>
          <Button variant="outline" href="/admin/products/{product.id}">Cancel</Button>
        </div>
      </Field.Group>
    </form>
  {/if}
</div>
