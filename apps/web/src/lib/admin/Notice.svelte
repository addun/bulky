<script lang="ts">
  import * as Alert from '$lib/components/ui/alert/index.js';

  let { message = '' }: { message?: string } = $props();
</script>

{#if message}
  <Alert.Root variant="destructive">
    <Alert.Description>{message}</Alert.Description>
  </Alert.Root>
{/if}
