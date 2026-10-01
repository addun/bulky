<script lang="ts">
  import Notice from '$lib/admin/Notice.svelte';
  import StoreForm from '$lib/admin/StoreForm.svelte';
  let { data, form } = $props();
</script>
<svelte:head><title>Add store · Bulkly</title></svelte:head>

<Notice message={form?.message} />
<StoreForm creating store={form?.store ?? data.store} retailChains={data.retailChains} next={form?.next ?? data.next} />
