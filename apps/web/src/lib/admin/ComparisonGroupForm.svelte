<script lang="ts">
  import { Button } from '$lib/components/ui/button/index.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import * as Field from '$lib/components/ui/field/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import * as NativeSelect from '$lib/components/ui/native-select/index.js';
  import { resourceView, arr, flag, obj, text } from '$lib/admin/view';

  let props = $props();
  const view = $derived(resourceView(props));
  const isNew = $derived(flag(view['new']));
  const group = $derived(obj(view.group));
  const units = $derived(arr(view.units));
  const products = $derived(arr(view.products));
  const action = $derived(isNew ? '/admin/comparison-groups/new' : `/admin/comparison-groups/${text(group.id)}/edit`);
  let selected = $state<Record<string, boolean>>(
    Object.fromEntries(arr(view.products).map((row) => [text(obj(row).id), obj(row).selected === true])),
  );
</script>

<h1 class="text-2xl font-semibold tracking-tight">{isNew ? 'Add comparison group' : 'Edit comparison group'}</h1>
<form method="post" {action}>
  <Field.Group class="max-w-xl">
    <Field.Set>
      <Field.Legend>Group</Field.Legend>
      <Field.Field>
        <Field.Label for="name">Name <span class="text-destructive">*</span></Field.Label>
        <Input id="name" name="name" required value={text(group.name)} autofocus />
      </Field.Field>
      <Field.Field>
        <Field.Label for="unit">Compare in <span class="text-destructive">*</span></Field.Label>
        <NativeSelect.Root id="unit" class="w-full" name="unit_id" required value={text(group.unitId)}>
          <NativeSelect.Option value="">Select…</NativeSelect.Option>
          {#each units as unit (text(obj(unit).id))}
            {@const row = obj(unit)}
            <NativeSelect.Option value={text(row.id)}>{text(row.name)}</NativeSelect.Option>
          {/each}
        </NativeSelect.Root>
        <Field.Description>Members need this as their purchase unit, or a conversion to it. Rankings use the latest logged price per kg, litre, or whichever unit you pick.</Field.Description>
      </Field.Field>
    </Field.Set>

    <Field.Set>
      <Field.Legend>Products</Field.Legend>
      {#if products.length === 0}
        <Field.Description>No products yet. <a href="/admin/products/new">Add a product</a> first.</Field.Description>
      {:else}
        <div class="flex flex-col gap-3">
          {#each products as product (text(obj(product).id))}
            {@const row = obj(product)}
            {@const id = text(row.id)}
            <Field.Field orientation="horizontal">
              <Checkbox id="product-{id}" name="product_id" value={id} bind:checked={selected[id]} />
              <Field.Label for="product-{id}">{text(row.name)} <span class="text-muted-foreground">{text(row.unitName)}</span></Field.Label>
            </Field.Field>
          {/each}
        </div>
      {/if}
    </Field.Set>

    <div class="flex flex-wrap items-center gap-2">
      <Button type="submit">{isNew ? 'Add group' : 'Save group'}</Button>
      <Button variant="outline" href="/admin/comparison-groups">Cancel</Button>
    </div>
  </Field.Group>
</form>
