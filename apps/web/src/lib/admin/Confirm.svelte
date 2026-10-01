<script lang="ts">
  import { page } from '$app/state';
  import { Button } from '$lib/components/ui/button/index.js';
  import { resourceView, text } from '$lib/admin/view';

  let props = $props();
  const view = $derived(resourceView(props));
  const action = $derived(`${page.url.pathname}${page.url.search}`);
</script>

<div class="flex max-w-xl flex-col gap-4">
  <h1 class="text-2xl font-semibold tracking-tight">{text(view.title)}</h1>
  <p class="text-muted-foreground">{text(view.body)}</p>
  <form method="post" {action}>
    <div class="flex flex-wrap items-center gap-2">
      <Button type="submit" variant="destructive">{text(view.confirm)}</Button>
      <Button variant="outline" href={text(view.cancel)}>Cancel</Button>
    </div>
  </form>
</div>
