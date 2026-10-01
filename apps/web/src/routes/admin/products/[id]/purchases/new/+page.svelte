<script lang="ts">
  import Notice from '$lib/admin/Notice.svelte';
  import PurchaseForm from '$lib/admin/PurchaseForm.svelte';
  let { data, form } = $props();
</script>
<svelte:head><title>Add purchase · Bulkly</title></svelte:head>

<Notice message={form?.message} />
<PurchaseForm creating product={data.product} purchase={form?.purchase ?? data.purchase} stores={data.stores} symbol={data.symbol} currency={data.currency} />
