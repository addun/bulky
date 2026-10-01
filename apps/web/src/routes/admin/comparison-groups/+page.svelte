<script lang="ts">
  import Notice from '$lib/admin/Notice.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Empty from '$lib/components/ui/empty/index.js';
  import * as Table from '$lib/components/ui/table/index.js';
  import { resourceView, arr, countLabel, obj, text } from '$lib/admin/view';
  let { data } = $props();
  const props = $derived({
    groups: data.groups,
  });

  const view = $derived(resourceView(props));
  const groups = $derived(arr(view.groups));
</script>

<svelte:head><title>Comparison groups · Bulkly</title></svelte:head>

<Notice message={data.error} />
<div class="flex flex-wrap items-center justify-between gap-3">
  <h1 class="text-2xl font-semibold tracking-tight">Comparison groups</h1>
  <Button href="/admin/comparison-groups/new">Add group</Button>
</div>

{#if groups.length === 0}
  <Empty.Root class="border">
    <Empty.Header>
      <Empty.Title>No comparison groups yet.</Empty.Title>
    </Empty.Header>
  </Empty.Root>
{:else}
  <Table.Root>
    <Table.Header>
      <Table.Row>
        <Table.Head>Name</Table.Head>
        <Table.Head>Unit</Table.Head>
        <Table.Head>Products</Table.Head>
        <Table.Head class="text-right">Actions</Table.Head>
      </Table.Row>
    </Table.Header>
    <Table.Body>
      {#each groups as group (text(obj(group).id))}
        {@const row = obj(group)}
        <Table.Row>
          <Table.Cell class="font-medium">{text(row.name)}</Table.Cell>
          <Table.Cell>{text(row.unitName)}</Table.Cell>
          <Table.Cell>{countLabel(Number(row.productCount) || 0, 'product', 'products')}</Table.Cell>
          <Table.Cell class="text-right">
            <Button variant="ghost" size="sm" href="/admin/comparison-groups/{row.id}/edit">Edit</Button>
            <Button variant="ghost" size="sm" class="text-destructive" href="/admin/comparison-groups/{row.id}/delete">Delete</Button>
          </Table.Cell>
        </Table.Row>
      {/each}
    </Table.Body>
  </Table.Root>
{/if}
