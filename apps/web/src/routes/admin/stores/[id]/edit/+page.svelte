<script lang="ts">
  import Notice from '$lib/admin/Notice.svelte';
  import StoreForm from '$lib/admin/StoreForm.svelte';
  let { data, form } = $props();
</script>
<svelte:head><title>Edit store · Bulkly</title></svelte:head>

<Notice message={form?.message} />
<StoreForm store={form?.store ?? data.store} retailChains={data.retailChains} />
