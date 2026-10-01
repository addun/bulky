<script lang="ts">
  import Notice from '$lib/admin/Notice.svelte';
  import Confirm from '$lib/admin/Confirm.svelte';
  let { data, form } = $props();
  const noun = data.purchase.kind === 'price' ? 'price' : 'purchase';
</script>
<svelte:head><title>Delete purchase · Bulkly</title></svelte:head>

<Notice message={form?.message} />
<Confirm
  title={`Delete this ${noun} of ${data.product.name}?`}
  body={noun === 'price' ? 'The product stays. Only this price is removed from the history.' : 'The product stays. Only this buy is removed from the history.'}
  action="?/default"
  cancel={`/admin/products/${data.product.id}`}
  confirm={`Delete ${noun}`}
/>
