<script lang="ts">
  import Notice from '$lib/admin/Notice.svelte';
  import ComparisonGroupForm from '$lib/admin/ComparisonGroupForm.svelte';
  let { data, form } = $props();
</script>
<svelte:head><title>Add comparison group · Bulkly</title></svelte:head>

<Notice message={form?.message} />
<ComparisonGroupForm creating group={form?.group ?? data.group} units={form?.units ?? data.units} products={form?.products ?? data.products} />
