<script lang="ts">
  import * as Alert from '$lib/components/ui/alert/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { resourceView, obj, text } from '$lib/admin/view';

  let props = $props();
  const view = $derived(resourceView(props));
  const receipt = $derived(obj(view.receipt));
</script>

<h1 class="text-2xl font-semibold tracking-tight">Receipt</h1>

<div class="grid items-start gap-6 lg:grid-cols-[16rem_1fr]">
  {#if receipt.imagePath}
    <img class="w-full rounded-xl border" src="/api/admin/receipts/{receipt.id}/preview" alt="Uploaded bill" />
  {/if}

  <div class="flex flex-col gap-3">
    <Badge variant="secondary" class="w-fit">{text(receipt.statusLabel)}</Badge>
    {#if receipt.reading}
      <p>Reading the bill. This can take a minute.</p>
      <p class="text-muted-foreground text-sm">This page refreshes on its own. You can also <a class="underline underline-offset-4" href="/admin/receipts/{receipt.id}">refresh it yourself</a>.</p>
    {:else}
      {#if receipt.errorMessage}
        <Alert.Root variant="destructive">
          <Alert.Description>{text(receipt.errorMessage)}</Alert.Description>
        </Alert.Root>
      {/if}
      <p class="text-muted-foreground">This scan has no product list yet.</p>
      <form method="post" action="?/retry">
        <Button type="submit">Read again</Button>
      </form>
      <p class="text-muted-foreground text-sm">Or upload a new photo from <a class="underline underline-offset-4" href="/admin/receipts">Receipts</a>.</p>
    {/if}
    <Button variant="destructive" class="w-fit" href="/admin/receipts/{receipt.id}/delete">Delete receipt</Button>
  </div>
</div>
