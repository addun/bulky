<script lang="ts">
  import Notice from '$lib/admin/Notice.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Field from '$lib/components/ui/field/index.js';
  import * as NativeSelect from '$lib/components/ui/native-select/index.js';
  import { resourceView, arr, obj, text } from '$lib/admin/view';
  let { data, form } = $props();
  const props = $derived({
    product: data.product,
    targets: data.targets,
    intoId: form?.intoId ?? 0,
  });

  const view = $derived(resourceView(props));
  const product = $derived(obj(view.product));
  const targets = $derived(arr(view.targets));
</script>

<svelte:head><title>Merge product · Bulkly</title></svelte:head>

<Notice message={form?.message} />
<div class="flex max-w-xl flex-col gap-4">
  <h1 class="text-2xl font-semibold tracking-tight">Merge {text(product.name)}?</h1>
  <p class="text-muted-foreground">Pick the product to keep. You will see a summary before anything is removed.</p>
  {#if targets.length === 0}
    <p class="text-muted-foreground text-sm">There is no other product to merge into.</p>
    <Button variant="outline" href="/admin/products/{product.id}">Cancel</Button>
  {:else}
    <form method="post" action="/admin/products/{product.id}/merge-with">
      <Field.Group>
        <Field.Field>
          <Field.Label for="into">Merge into <span class="text-destructive">*</span></Field.Label>
          <NativeSelect.Root id="into" class="w-full" name="into_id" required value={text(view.intoId)}>
            <NativeSelect.Option value="">Select…</NativeSelect.Option>
            {#each targets as target (text(obj(target).id))}
              {@const row = obj(target)}
              <NativeSelect.Option value={text(row.id)}>{text(row.name)} ({text(row.unitName)})</NativeSelect.Option>
            {/each}
          </NativeSelect.Root>
        </Field.Field>
        <div class="flex flex-wrap items-center gap-2">
          <Button type="submit">Continue</Button>
          <Button variant="outline" href="/admin/products/{product.id}">Cancel</Button>
        </div>
      </Field.Group>
    </form>
  {/if}
</div>
