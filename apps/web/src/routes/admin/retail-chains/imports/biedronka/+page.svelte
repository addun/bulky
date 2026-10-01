<script lang="ts">
  import Notice from '$lib/admin/Notice.svelte';
  import * as Alert from '$lib/components/ui/alert/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Field from '$lib/components/ui/field/index.js';
  import * as NativeSelect from '$lib/components/ui/native-select/index.js';
  import { resourceView, arr, num, obj, text } from '$lib/admin/view';
  let { data, form } = $props();
  const props = $derived({
    retailChains: data.retailChains,
    retailChainId: form?.retailChainId ?? data.retailChainId,
    result: form?.result ?? null,
  });

  const view = $derived(resourceView(props));
  const chains = $derived(arr(view.retailChains));
  const result = $derived(view.result ? obj(view.result) : null);
</script>

<svelte:head><title>Import Biedronka shops · Bulkly</title></svelte:head>

<Notice message={form?.message} />
<div class="flex flex-col gap-2">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <h1 class="text-2xl font-semibold tracking-tight">Import Biedronka shops</h1>
    <Button variant="outline" href="/admin/retail-chains/imports">Imports</Button>
  </div>
  <p class="text-muted-foreground max-w-2xl">Loads every shop from moja.biedronka.pl, then creates or updates stores for the selected chain. Matching uses the Biedronka shop number. Existing postal codes and apartment numbers stay.</p>
</div>

{#if result}
  <Alert.Root>
    <Alert.Description>
      Imported {text(result.total)} shops: {text(result.created)} created, {text(result.updated)} updated{#if num(result.skipped)}, {text(result.skipped)} skipped{/if}.
      <a href="/admin/stores">View stores</a>
    </Alert.Description>
  </Alert.Root>
{/if}

<form method="post" action="/admin/retail-chains/imports/biedronka">
  <Field.Group class="max-w-xl">
    <Field.Set>
      <Field.Legend>Retail chain</Field.Legend>
      <Field.Field>
        <Field.Label for="chain">Chain <span class="text-destructive">*</span></Field.Label>
        <NativeSelect.Root id="chain" class="w-full" name="retail_chain_id" required disabled={chains.length === 0} value={text(view.retailChainId)}>
          <NativeSelect.Option value="">Choose a chain</NativeSelect.Option>
          {#each chains as chain (text(obj(chain).id))}
            {@const row = obj(chain)}
            <NativeSelect.Option value={text(row.id)}>{text(row.label)}</NativeSelect.Option>
          {/each}
        </NativeSelect.Root>
      </Field.Field>
      {#if chains.length === 0}
        <Field.Description>No retail chains yet. <a href="/admin/retail-chains/new">Add a chain</a> first.</Field.Description>
      {/if}
    </Field.Set>
    <div class="flex flex-wrap items-center gap-2">
      <Button type="submit" disabled={chains.length === 0}>Import shops</Button>
      <Button variant="outline" href="/admin/retail-chains/imports">Cancel</Button>
    </div>
  </Field.Group>
</form>
