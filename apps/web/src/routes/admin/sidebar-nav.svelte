<script lang="ts">
  import BoxesIcon from '@lucide/svelte/icons/boxes';
  import Building2Icon from '@lucide/svelte/icons/building-2';
  import LayersIcon from '@lucide/svelte/icons/layers';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import ReceiptIcon from '@lucide/svelte/icons/receipt';
  import RulerIcon from '@lucide/svelte/icons/ruler';
  import SettingsIcon from '@lucide/svelte/icons/settings';
  import StoreIcon from '@lucide/svelte/icons/store';
  import TagsIcon from '@lucide/svelte/icons/tags';
  import { page } from '$app/state';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Sidebar from '$lib/components/ui/sidebar/index.js';

  const sidebar = Sidebar.useSidebar();
  const path = $derived(page.url.pathname);

  function current(href: string): boolean {
    if (href === '/admin/products') {
      return (
        path === '/admin/products' ||
        path.startsWith('/admin/purchases/') ||
        (path.startsWith('/admin/products/') && path !== '/admin/products/new')
      );
    }
    return path === href || path.startsWith(`${href}/`);
  }

  function close() {
    sidebar.setOpenMobile(false);
  }

  let seen = path;
  $effect(() => {
    if (path === seen) return;
    seen = path;
    close();
  });
</script>

{#snippet item(href: string, label: string)}
  <Sidebar.MenuItem>
    <Sidebar.MenuButton isActive={current(href)}>
      {#snippet child({ props })}
        <a {href} {...props} onclick={close}>
          {#if href === '/admin/products'}
            <BoxesIcon />
          {:else if href === '/admin/units'}
            <RulerIcon />
          {:else if href === '/admin/aliases'}
            <TagsIcon />
          {:else if href === '/admin/comparison-groups'}
            <LayersIcon />
          {:else if href === '/admin/receipts'}
            <ReceiptIcon />
          {:else if href === '/admin/retail-chains'}
            <Building2Icon />
          {:else if href === '/admin/stores'}
            <StoreIcon />
          {:else}
            <SettingsIcon />
          {/if}
          <span>{label}</span>
        </a>
      {/snippet}
    </Sidebar.MenuButton>
  </Sidebar.MenuItem>
{/snippet}

<Sidebar.Content>
  <Sidebar.Group>
    <Sidebar.GroupLabel>Catalog</Sidebar.GroupLabel>
    <Sidebar.GroupContent>
      <Sidebar.Menu class="gap-1">
        {@render item('/admin/products', 'Products')}
        {@render item('/admin/units', 'Units')}
        {@render item('/admin/aliases', 'Aliases')}
        {@render item('/admin/comparison-groups', 'Comparison groups')}
        {@render item('/admin/receipts', 'Receipts')}
      </Sidebar.Menu>
    </Sidebar.GroupContent>
  </Sidebar.Group>
  <Sidebar.Group>
    <Sidebar.GroupLabel>Shops</Sidebar.GroupLabel>
    <Sidebar.GroupContent>
      <Sidebar.Menu class="gap-1">
        {@render item('/admin/retail-chains', 'Retail chains')}
        {@render item('/admin/stores', 'Stores')}
      </Sidebar.Menu>
    </Sidebar.GroupContent>
  </Sidebar.Group>
  <Sidebar.Group>
    <Sidebar.GroupLabel>Administration</Sidebar.GroupLabel>
    <Sidebar.GroupContent>
      <Sidebar.Menu class="gap-1">
        {@render item('/admin/settings', 'Settings')}
      </Sidebar.Menu>
    </Sidebar.GroupContent>
  </Sidebar.Group>
</Sidebar.Content>
<Sidebar.Footer>
  <Button href="/admin/products/new" variant={current('/admin/products/new') ? 'secondary' : 'default'} onclick={close}>
    <PlusIcon />
    Add product
  </Button>
</Sidebar.Footer>
