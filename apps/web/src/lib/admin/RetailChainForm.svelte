<script lang="ts">
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Field from '$lib/components/ui/field/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { resourceView, flag, obj, text } from '$lib/admin/view';

  let props = $props();
  const view = $derived(resourceView(props));
  const isNew = $derived(flag(view['new']));
  const chain = $derived(obj(view.retailChain));
  const action = $derived(isNew ? '/admin/retail-chains/new' : `/admin/retail-chains/${text(chain.id)}/edit`);
</script>

<h1 class="text-2xl font-semibold tracking-tight">{isNew ? 'Add retail chain' : 'Edit retail chain'}</h1>
<form method="post" {action}>
  <Field.Group class="max-w-xl">
    <Field.Set>
      <Field.Legend>Chain</Field.Legend>
      <Field.Field>
        <Field.Label for="name">Name <span class="text-destructive">*</span></Field.Label>
        <Input id="name" name="name" required value={text(chain.name)} autofocus />
      </Field.Field>
      <Field.Field>
        <Field.Label for="legal-name">Legal name <span class="text-destructive">*</span></Field.Label>
        <Input id="legal-name" name="legal_name" required value={text(chain.legalName)} />
      </Field.Field>
      <Field.Field>
        <Field.Label for="tax-id">Tax ID <span class="text-destructive">*</span></Field.Label>
        <Input id="tax-id" name="tax_id" required value={text(chain.taxId)} inputmode="numeric" autocomplete="off" />
      </Field.Field>
    </Field.Set>
    <div class="flex flex-wrap items-center gap-2">
      <Button type="submit">{isNew ? 'Add chain' : 'Save chain'}</Button>
      <Button variant="outline" href="/admin/retail-chains">Cancel</Button>
    </div>
  </Field.Group>
</form>
