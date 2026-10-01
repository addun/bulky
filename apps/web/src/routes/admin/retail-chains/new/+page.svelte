<script lang="ts">
  import Notice from '$lib/admin/Notice.svelte';
  import RetailChainForm from '$lib/admin/RetailChainForm.svelte';
  let { form } = $props();
</script>
<svelte:head><title>Add retail chain · Bulkly</title></svelte:head>

<Notice message={form?.message} />
<RetailChainForm creating retailChain={form?.retailChain ?? { id: 0, name: '', legalName: '', taxId: '' }} />
