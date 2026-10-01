<script lang="ts">
  import Notice from '$lib/admin/Notice.svelte';
  import AliasForm from '$lib/admin/AliasForm.svelte';
  let { data, form } = $props();
  const from = form?.fromProduct ?? data.fromProduct;
</script>
<svelte:head><title>Edit alias · Bulkly</title></svelte:head>

<Notice message={form?.message} />
<AliasForm
  alias={form?.alias ?? data.alias}
  products={data.products}
  stores={data.stores}
  chains={data.chains}
  lockedProduct={data.lockedProduct}
  fromProduct={from}
  cancel={from ? `/admin/aliases?product=${from}` : '/admin/aliases'}
/>
