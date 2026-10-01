<script lang="ts">
  import Notice from '$lib/admin/Notice.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Empty from '$lib/components/ui/empty/index.js';
  import * as Table from '$lib/components/ui/table/index.js';
  import { resourceView, arr, countLabel, obj, text } from '$lib/admin/view';
  let { data } = $props();
  const props = $derived({
    retailChains: data.retailChains,
  });

  const view = $derived(resourceView(props));
  const chains = $derived(arr(view.retailChains));
</script>

<svelte:head><title>Retail chains · Bulkly</title></svelte:head>

<Notice message={data.error} />
<div class="flex flex-wrap items-center justify-between gap-3">
  <h1 class="text-2xl font-semibold tracking-tight">Retail chains</h1>
  <div class="flex gap-2">
    <Button variant="outline" href="/admin/retail-chains/imports">Imports</Button>
    <Button href="/admin/retail-chains/new">Add chain</Button>
  </div>
</div>

{#if chains.length === 0}
  <Empty.Root class="border">
    <Empty.Header>
      <Empty.Title>No retail chains yet.</Empty.Title>
    </Empty.Header>
  </Empty.Root>
{:else}
  <Table.Root>
    <Table.Header>
      <Table.Row>
        <Table.Head>Name</Table.Head>
        <Table.Head>Legal name</Table.Head>
        <Table.Head>Tax ID</Table.Head>
        <Table.Head>Stores</Table.Head>
        <Table.Head class="text-right">Actions</Table.Head>
      </Table.Row>
    </Table.Header>
    <Table.Body>
      {#each chains as chain (text(obj(chain).id))}
        {@const row = obj(chain)}
        <Table.Row>
          <Table.Cell class="font-medium">{text(row.name)}</Table.Cell>
          <Table.Cell>{text(row.legalName)}</Table.Cell>
          <Table.Cell>{text(row.taxId)}</Table.Cell>
          <Table.Cell>{countLabel(Number(row.storeCount) || 0, 'store', 'stores')}</Table.Cell>
          <Table.Cell class="text-right">
            <Button variant="ghost" size="sm" href="/admin/retail-chains/{row.id}/edit">Edit</Button>
            {#if !row.storeCount}
              <Button variant="ghost" size="sm" class="text-destructive" href="/admin/retail-chains/{row.id}/delete">Delete</Button>
            {/if}
          </Table.Cell>
        </Table.Row>
      {/each}
    </Table.Body>
  </Table.Root>
{/if}
