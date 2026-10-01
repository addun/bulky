<script lang="ts">
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Field from '$lib/components/ui/field/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import * as NativeSelect from '$lib/components/ui/native-select/index.js';
  import { resourceView, arr, flag, obj, text } from '$lib/admin/view';

  let props = $props();
  const view = $derived(resourceView(props));
  const isNew = $derived(flag(view['new']));
  const store = $derived(obj(view.store));
  const chains = $derived(arr(view.retailChains));
  const next = $derived(text(view.next));
  const action = $derived(isNew ? '/admin/stores/new' : `/admin/stores/${text(store.id)}/edit`);
  const cancel = $derived(next || '/admin/stores');
</script>

<h1 class="text-2xl font-semibold tracking-tight">{isNew ? 'Add store' : 'Edit store'}</h1>
<form method="post" {action}>
  <Field.Group class="max-w-xl">
    {#if next}<input type="hidden" name="next" value={next} />{/if}
    <Field.Set>
      <Field.Legend>Name</Field.Legend>
      <Field.Field>
        <Field.Label for="name">Name <span class="text-destructive">*</span></Field.Label>
        <Input id="name" name="name" required value={text(store.name)} autofocus />
      </Field.Field>
      <Field.Field>
        <Field.Label for="chain">Retail chain</Field.Label>
        <NativeSelect.Root id="chain" class="w-full" name="retail_chain_id" value={text(store.retailChainId)}>
          <NativeSelect.Option value="">None</NativeSelect.Option>
          {#each chains as chain (text(obj(chain).id))}
            {@const row = obj(chain)}
            <NativeSelect.Option value={text(row.id)}>{text(row.label)}</NativeSelect.Option>
          {/each}
        </NativeSelect.Root>
      </Field.Field>
      <Field.Field>
        <Field.Label for="code">Store code</Field.Label>
        <Input id="code" name="external_id" value={text(store.externalId)} />
        <Field.Description>Printed on the bill.</Field.Description>
      </Field.Field>
      {#if chains.length === 0}
        <Field.Description>No retail chains yet. You can still save, or <a href="/admin/retail-chains/new">add a chain</a> first.</Field.Description>
      {/if}
    </Field.Set>
    <Field.Set>
      <Field.Legend>Address</Field.Legend>
      <Field.Field>
        <Field.Label for="street">Street name <span class="text-destructive">*</span></Field.Label>
        <Input id="street" name="street_name" required value={text(store.streetName)} autocomplete="street-address" />
      </Field.Field>
      <div class="grid gap-4 sm:grid-cols-2">
        <Field.Field>
          <Field.Label for="building">Building number <span class="text-destructive">*</span></Field.Label>
          <Input id="building" name="building_number" required value={text(store.buildingNumber)} />
        </Field.Field>
        <Field.Field>
          <Field.Label for="apartment">Apartment number</Field.Label>
          <Input id="apartment" name="apartment_number" value={text(store.apartmentNumber)} />
        </Field.Field>
      </div>
      <div class="grid gap-4 sm:grid-cols-[8rem_1fr]">
        <Field.Field>
          <Field.Label for="postal">Postal code <span class="text-destructive">*</span></Field.Label>
          <Input id="postal" name="postal_code" required value={text(store.postalCode)} autocomplete="postal-code" />
        </Field.Field>
        <Field.Field>
          <Field.Label for="city">City <span class="text-destructive">*</span></Field.Label>
          <Input id="city" name="city" required value={text(store.city)} />
        </Field.Field>
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        <Field.Field>
          <Field.Label for="lat">Latitude</Field.Label>
          <Input id="lat" name="lat" inputmode="decimal" value={text(store.lat)} />
        </Field.Field>
        <Field.Field>
          <Field.Label for="lng">Longitude</Field.Label>
          <Input id="lng" name="lng" inputmode="decimal" value={text(store.lng)} />
        </Field.Field>
      </div>
    </Field.Set>
    <div class="flex flex-wrap items-center gap-2">
      <Button type="submit">{isNew ? 'Add store' : 'Save store'}</Button>
      <Button variant="outline" href={cancel}>Cancel</Button>
    </div>
  </Field.Group>
</form>
{#if !isNew}
  <Button variant="outline" href="/admin/stores/{store.id}/merge-with">Merge</Button>
{/if}
