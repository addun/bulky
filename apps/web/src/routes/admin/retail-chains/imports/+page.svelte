<script lang="ts">
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Table from '$lib/components/ui/table/index.js';
  import { resourceView, arr, obj, text } from '$lib/admin/view';
  let { data } = $props();
  const props = $derived({
    importers: data.importers,
  });

  const view = $derived(resourceView(props));
  const importers = $derived(arr(view.importers));
</script>

<svelte:head><title>Imports · Bulkly</title></svelte:head>
<div class="flex flex-col gap-2">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <h1 class="text-2xl font-semibold tracking-tight">Imports</h1>
    <Button variant="outline" href="/admin/retail-chains">Retail chains</Button>
  </div>
  <p class="text-muted-foreground max-w-2xl">Fill stores from a chain’s public shop list. Each importer asks which retail chain to attach the shops to, then creates or updates matching stores.</p>
</div>

<Table.Root>
  <Table.Header>
    <Table.Row>
      <Table.Head>Importer</Table.Head>
      <Table.Head class="text-right">Actions</Table.Head>
    </Table.Row>
  </Table.Header>
  <Table.Body>
    {#each importers as importer (text(obj(importer).id))}
      {@const row = obj(importer)}
      <Table.Row>
        <Table.Cell>
          <span class="font-medium">{text(row.name)}</span>
          <span class="text-muted-foreground block text-sm">{text(row.description)}</span>
        </Table.Cell>
        <Table.Cell class="text-right">
          <Button variant="ghost" size="sm" href={text(row.href)}>Open</Button>
        </Table.Cell>
      </Table.Row>
    {/each}
  </Table.Body>
</Table.Root>
