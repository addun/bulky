<script lang="ts">
  import Notice from '$lib/admin/Notice.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import { resourceView, countLabel, num, obj, text } from '$lib/admin/view';
  let { data, form } = $props();
  const props = $derived({
    plan: data.plan,
  });

  const view = $derived(resourceView(props));
  const plan = $derived(obj(view.plan));
  const from = $derived(obj(plan.from));
  const into = $derived(obj(plan.into));
  const history = $derived(num(plan.history));
  const aliases = $derived(num(plan.aliases));
</script>

<svelte:head><title>Merge store · Bulkly</title></svelte:head>

<Notice message={form?.message} />
<div class="flex max-w-xl flex-col gap-4">
  <h1 class="text-2xl font-semibold tracking-tight">Merge {text(from.name)}?</h1>
  <p class="text-muted-foreground">You are going to merge:</p>
  <ul class="list-disc space-y-1 pl-5 text-sm">
    <li><strong>{text(from.name)}</strong> into <strong>{text(into.name)}</strong></li>
    <li>{text(from.name)} will be removed</li>
    {#if history}
      <li>{countLabel(history, 'purchase', 'purchases')} will move to {text(into.name)}</li>
    {:else}
      <li>Nothing in the history to move</li>
    {/if}
    {#if aliases}
      <li>{countLabel(aliases, 'alias', 'aliases')} will move to {text(into.name)}</li>
    {:else}
      <li>No aliases to move</li>
    {/if}
    {#if plan.takeCode}
      <li>{text(from.name)}’s store code will be used ({text(into.name)} has none)</li>
    {/if}
    {#if plan.takeCoords}
      <li>{text(from.name)}’s map location will be used ({text(into.name)} has none)</li>
    {/if}
    {#if plan.takeChain}
      <li>{text(from.name)}’s retail chain will be used ({text(into.name)} has none)</li>
    {/if}
  </ul>
  <form method="post" action="/admin/stores/{from.id}/merge-with/{into.id}">
    <div class="flex flex-wrap items-center gap-2">
      <Button type="submit" variant="destructive">Merge and delete this store</Button>
      <Button variant="outline" href="/admin/stores/{from.id}/merge-with?into_id={into.id}">Back</Button>
    </div>
  </form>
</div>
