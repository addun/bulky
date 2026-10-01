<script lang="ts">
  import { Button } from '$lib/components/ui/button/index.js';

  let { children } = $props();
</script>

<header class="flex h-14 items-center justify-end border-b px-4">
  <Button href="/admin" variant="outline">Panel</Button>
</header>
<main class="mx-auto flex w-full max-w-3xl flex-1 flex-col p-4 md:p-8">
  {@render children()}
</main>
