<script lang="ts">
  import * as Sidebar from '$lib/components/ui/sidebar/index.js';
  import SidebarNav from './sidebar-nav.svelte';

  let { children } = $props();
</script>

<Sidebar.Provider>
  <Sidebar.Root>
    <Sidebar.Header class="h-14 justify-center px-4">
      <a href="/" data-sveltekit-reload class="text-sm font-semibold tracking-tight">Bulkly</a>
    </Sidebar.Header>
    <SidebarNav />
  </Sidebar.Root>
  <Sidebar.Inset>
    <header class="flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <Sidebar.Trigger />
    </header>
    <div class="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-4 md:p-6">
      {@render children()}
    </div>
  </Sidebar.Inset>
</Sidebar.Provider>
