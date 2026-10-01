<script lang="ts">
  import Notice from '$lib/admin/Notice.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Empty from '$lib/components/ui/empty/index.js';
  import * as Table from '$lib/components/ui/table/index.js';
  import { resourceView, arr, obj, text } from '$lib/admin/view';
  let { data } = $props();
  const props = $derived({
    aliases: data.aliases,
    filter: data.filter,
    productQuery: data.productQuery,
  });

  const view = $derived(resourceView(props));
  const aliases = $derived(arr(view.aliases));
  const filter = $derived(view.filter ? obj(view.filter) : null);
  const productQuery = $derived(text(view.productQuery));
</script>

<svelte:head><title>Aliases · Bulkly</title></svelte:head>

<Notice message={data.error} />
<div class="flex flex-wrap items-start justify-between gap-3">
  {#if filter}
    <div class="flex flex-col gap-1">
      <h1 class="text-2xl font-semibold tracking-tight">Aliases for {text(filter.name)}</h1>
      <Button variant="link" class="h-auto px-0" href="/admin/aliases">All aliases</Button>
    </div>
    <Button href="/admin/aliases/new?product={filter.id}">Add alias</Button>
  {:else}
    <h1 class="text-2xl font-semibold tracking-tight">Aliases</h1>
    <Button href="/admin/aliases/new">Add alias</Button>
  {/if}
</div>

{#if aliases.length === 0}
  <Empty.Root class="border">
    <Empty.Header>
      <Empty.Title>{filter ? 'No aliases for this product.' : 'No aliases yet.'}</Empty.Title>
    </Empty.Header>
  </Empty.Root>
{:else}
  <Table.Root>
    <Table.Header>
      <Table.Row>
        <Table.Head>Alias</Table.Head>
        <Table.Head>Product</Table.Head>
        <Table.Head>Scope</Table.Head>
        <Table.Head class="text-right">Actions</Table.Head>
      </Table.Row>
    </Table.Header>
    <Table.Body>
      {#each aliases as alias (text(obj(alias).id))}
        {@const row = obj(alias)}
        <Table.Row>
          <Table.Cell class="font-medium">{text(row.alias)}</Table.Cell>
          <Table.Cell>{text(row.productName)}</Table.Cell>
          <Table.Cell>{text(row.scopeLabel)}</Table.Cell>
          <Table.Cell class="text-right">
            <Button variant="ghost" size="sm" href="/admin/aliases/{row.id}/edit{productQuery}">Edit</Button>
            <Button variant="ghost" size="sm" class="text-destructive" href="/admin/aliases/{row.id}/delete{productQuery}">Delete</Button>
          </Table.Cell>
        </Table.Row>
      {/each}
    </Table.Body>
  </Table.Root>
{/if}
