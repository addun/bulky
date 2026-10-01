<script lang="ts">
  import Notice from '$lib/admin/Notice.svelte';
  import Confirm from '$lib/admin/Confirm.svelte';
  let { data, form } = $props();
</script>
<svelte:head><title>Delete retail chain · Bulkly</title></svelte:head>

<Notice message={form?.message} />
<Confirm
  title={`Delete retail chain “${data.chain.name}”?`}
  body="This only removes the chain from the list. No stores use it."
  action="?/default"
  cancel="/admin/retail-chains"
  confirm="Delete chain"
/>
