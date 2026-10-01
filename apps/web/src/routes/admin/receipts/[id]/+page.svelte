<script lang="ts">
  import Notice from '$lib/admin/Notice.svelte';
  import ReceiptReview from './review.svelte';
  import ReceiptShow from './show.svelte';
  import ReceiptStatus from './status.svelte';
  let { data, form } = $props();
</script>
<svelte:head><title>Receipt · Bulkly</title></svelte:head>

<Notice message={form?.message || data.error} />
{#if data.kind === 'status'}
  <ReceiptStatus receipt={data.receipt} />
{:else if data.kind === 'review'}
  <ReceiptReview
    view={form?.view ?? data.view}
    products={form?.products ?? data.products}
    units={form?.units ?? data.units}
    stores={form?.stores ?? data.stores}
    symbol={form?.symbol ?? data.symbol}
    currency={form?.currency ?? data.currency}
  />
{:else}
  <ReceiptShow
    receipt={data.receipt}
    purchases={data.purchases}
    boughtOn={data.boughtOn}
    notes={data.notes}
    store={data.store}
    imported={data.imported}
    symbol={data.symbol}
  />
{/if}
