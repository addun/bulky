<script lang="ts">
  import Notice from '$lib/admin/Notice.svelte';
  import Confirm from '$lib/admin/Confirm.svelte';
  let { data, form } = $props();
</script>
<svelte:head><title>Delete store · Bulkly</title></svelte:head>

<Notice message={form?.message} />
<Confirm
  title={`Delete store “${data.store.name}”?`}
  body="This only removes the store from the list. No purchases use it."
  action="?/default"
  cancel="/admin/stores"
  confirm="Delete store"
/>
