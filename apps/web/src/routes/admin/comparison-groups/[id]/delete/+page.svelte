<script lang="ts">
  import Notice from '$lib/admin/Notice.svelte';
  import Confirm from '$lib/admin/Confirm.svelte';
  let { data, form } = $props();
</script>
<svelte:head><title>Delete comparison group · Bulkly</title></svelte:head>

<Notice message={form?.message} />
<Confirm
  title={`Delete comparison group “${data.group.name}”?`}
  body="Products stay in the catalog. They just leave this group."
  action="?/default"
  cancel="/admin/comparison-groups"
  confirm="Delete group"
/>
