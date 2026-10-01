<script lang="ts">
  import Notice from '$lib/admin/Notice.svelte';
  import AliasForm from '$lib/admin/AliasForm.svelte';
  let { data, form } = $props();
</script>
<svelte:head><title>Add alias · Bulkly</title></svelte:head>

<Notice message={form?.message} />
<AliasForm
  creating
  alias={form?.alias ?? data.alias}
  products={data.products}
  stores={data.stores}
  chains={data.chains}
  lockedProduct={data.lockedProduct}
  fromProduct={form?.fromProduct ?? data.fromProduct}
  cancel={data.fromProduct ? `/admin/aliases?product=${data.fromProduct}` : '/admin/aliases'}
/>
