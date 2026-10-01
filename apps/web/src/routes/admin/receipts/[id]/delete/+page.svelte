<script lang="ts">
  import { page } from '$app/state';
  import Notice from '$lib/admin/Notice.svelte';
  import Confirm from '$lib/admin/Confirm.svelte';
  let { data, form } = $props();
  const saved = data.status === 'migrated';
</script>
<svelte:head><title>Delete receipt · Bulkly</title></svelte:head>

<Notice message={form?.message} />
<Confirm
  title="Delete this receipt?"
  body={saved
    ? 'This removes the receipt and every purchase saved from this bill. Products with no other buys left are removed too.'
    : 'This removes the scan and the stored photo. Nothing has been saved as purchases yet.'}
  action="?/default"
  cancel={`/admin/receipts/${page.params.id}`}
  confirm="Delete receipt"
/>
