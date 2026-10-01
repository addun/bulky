<script lang="ts">
  import Notice from '$lib/admin/Notice.svelte';
  import RetailChainForm from '$lib/admin/RetailChainForm.svelte';
  let { data, form } = $props();
</script>
<svelte:head><title>Edit retail chain · Bulkly</title></svelte:head>

<Notice message={form?.message} />
<RetailChainForm retailChain={form?.retailChain ?? data.retailChain} />
