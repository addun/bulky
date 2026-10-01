<script lang="ts">
  import { qtyHint } from '$lib/format';

  let {
    quantity = '',
    amount = '',
    unit = '',
    compare = '1',
    symbol = '',
  }: {
    quantity?: string;
    amount?: string;
    unit?: string;
    compare?: string;
    symbol?: string;
  } = $props();

  const text = $derived(qtyHint(quantity, amount, unit, compare, symbol));
</script>

{#if text}
  <p class="text-muted-foreground text-sm">{text}</p>
{/if}
