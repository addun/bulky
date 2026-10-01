<script lang="ts">
  import Notice from '$lib/admin/Notice.svelte';
  import ProductForm from '$lib/admin/ProductForm.svelte';
  let { data, form } = $props();
</script>
<svelte:head><title>Add product · Bulkly</title></svelte:head>

<Notice message={form?.message} />
<ProductForm creating product={form?.product ?? data.product} units={form?.units ?? data.units} groups={form?.groups ?? data.groups} />
