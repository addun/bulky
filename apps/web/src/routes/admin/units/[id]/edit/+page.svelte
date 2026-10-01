<script lang="ts">
  import Notice from '$lib/admin/Notice.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Field from '$lib/components/ui/field/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { formatQty } from '$lib/format';
  import { resourceView, obj, text } from '$lib/admin/view';
  let { data, form } = $props();
  const props = $derived({
    unit: form?.unit ?? data,
    compareInput: form?.compareInput ?? '',
  });

  const view = $derived(resourceView(props));
  const unit = $derived(obj(view.unit));
  const compare = $derived(text(view.compareInput) || formatQty(text(unit.compareValue)));
</script>

<svelte:head><title>Edit unit · Bulkly</title></svelte:head>

<Notice message={form?.message} />
<h1 class="text-2xl font-semibold tracking-tight">Edit unit</h1>
<form method="post" action="/admin/units/{unit.id}/edit">
  <Field.Group class="max-w-xl">
    <Field.Field>
      <Field.Label for="name">Name <span class="text-destructive">*</span></Field.Label>
      <Input id="name" name="name" required value={text(unit.name)} autofocus />
    </Field.Field>
    <Field.Field>
      <Field.Label for="compare">Compare value <span class="text-destructive">*</span></Field.Label>
      <Input id="compare" name="compare_value" required inputmode="decimal" value={compare} />
      <Field.Description>Prices are shown per this much of the unit. Grams are usually 100, so 0,05 zł/g is shown as 5,00 zł / 100 g. Leave 1 to keep the price per single unit.</Field.Description>
    </Field.Field>
    <div class="flex flex-wrap items-center gap-2">
      <Button type="submit">Save</Button>
      <Button variant="outline" href="/admin/units">Cancel</Button>
    </div>
  </Field.Group>
</form>
