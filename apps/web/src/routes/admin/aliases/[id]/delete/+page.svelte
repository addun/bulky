<script lang="ts">
  import Notice from '$lib/admin/Notice.svelte';
  import Confirm from '$lib/admin/Confirm.svelte';
  let { data, form } = $props();
  const back = data.product ? `/admin/aliases?product=${data.product}` : '/admin/aliases';
</script>
<svelte:head><title>Delete alias · Bulkly</title></svelte:head>

<Notice message={form?.message} />
<Confirm
  title={`Delete alias “${data.alias.alias}”?`}
  body="This only removes the alternate name. The product stays."
  action="?/default"
  cancel={back}
  confirm="Delete alias"
/>
