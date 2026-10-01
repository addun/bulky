<script lang="ts">
  import Notice from '$lib/admin/Notice.svelte';
  import Confirm from '$lib/admin/Confirm.svelte';
  let { data, form } = $props();
</script>
<svelte:head><title>Delete unit · Bulkly</title></svelte:head>


<Notice message={form?.message} />
<Confirm
  title={`Delete unit “${data.unit.name}”?`}
  body="This only removes the unit from the list. No products use it."
  action="?/default"
  cancel="/admin/units"
  confirm="Delete unit"
/>
