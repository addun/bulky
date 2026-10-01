<script lang="ts">
  import { page } from '$app/state';
  import Notice from '$lib/admin/Notice.svelte';
  import Confirm from '$lib/admin/Confirm.svelte';
  let { data, form } = $props();
</script>
<svelte:head><title>Delete product · Bulkly</title></svelte:head>

<Notice message={form?.message} />
<Confirm
  title={`Delete ${data.product.name}?`}
  body="This removes the product and every purchase and price recorded for it. The unit stays."
  action="?/default"
  cancel={`/admin/products/${page.params.id}`}
  confirm="Delete product"
/>
