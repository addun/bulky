<script lang="ts">
  import Notice from '$lib/admin/Notice.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Empty from '$lib/components/ui/empty/index.js';
  import * as Table from '$lib/components/ui/table/index.js';
  import { resourceView, arr, countLabel, obj, text } from '$lib/admin/view';
  let { data } = $props();
  const props = $derived({
    stores: data.stores,
  });

  const view = $derived(resourceView(props));
  const stores = $derived(arr(view.stores));
</script>

<svelte:head><title>Stores · Bulkly</title></svelte:head>

<Notice message={data.error} />
<div class="flex flex-wrap items-center justify-between gap-3">
  <h1 class="text-2xl font-semibold tracking-tight">Stores</h1>
  <Button href="/admin/stores/new">Add store</Button>
</div>

{#if stores.length === 0}
  <Empty.Root class="border">
    <Empty.Header>
      <Empty.Title>No stores yet.</Empty.Title>
    </Empty.Header>
  </Empty.Root>
{:else}
  <Table.Root>
    <Table.Header>
      <Table.Row>
        <Table.Head>Name</Table.Head>
        <Table.Head>Address</Table.Head>
        <Table.Head>Purchases</Table.Head>
        <Table.Head class="text-right">Actions</Table.Head>
      </Table.Row>
    </Table.Header>
    <Table.Body>
      {#each stores as store (text(obj(store).id))}
        {@const row = obj(store)}
        <Table.Row>
          <Table.Cell>
            <span class="font-medium">{text(row.name)}</span>
            {#if row.retailChainName}<span class="text-muted-foreground block text-sm">{text(row.retailChainName)}</span>{/if}
            {#if row.externalId}<span class="text-muted-foreground block text-sm">{text(row.externalId)}</span>{/if}
          </Table.Cell>
          <Table.Cell>{text(row.addressLine)}</Table.Cell>
          <Table.Cell>{countLabel(Number(row.purchaseCount) || 0, 'purchase', 'purchases')}</Table.Cell>
          <Table.Cell class="text-right">
            <Button variant="ghost" size="sm" href="/admin/stores/{row.id}/edit">Edit</Button>
            <Button variant="ghost" size="sm" href="/admin/stores/{row.id}/merge-with">Merge</Button>
            {#if !row.purchaseCount}
              <Button variant="ghost" size="sm" class="text-destructive" href="/admin/stores/{row.id}/delete">Delete</Button>
            {/if}
          </Table.Cell>
        </Table.Row>
      {/each}
    </Table.Body>
  </Table.Root>
{/if}
