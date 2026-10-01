<script lang="ts">
  import SearchIcon from '@lucide/svelte/icons/search';
  import * as Alert from '$lib/components/ui/alert/index.js';
  import * as Card from '$lib/components/ui/card/index.js';
  import * as Empty from '$lib/components/ui/empty/index.js';
  import { Input } from '$lib/components/ui/input/index.js';

  type Extra = { price: string; unitName: string };
  type PromoCard = {
    id: number;
    name: string;
    image: string;
    tint: string;
    initial: string;
    now: string;
    extras: Extra[];
    priceNote: string;
  };

  const legacy = import.meta.env.DEV ? 'http://127.0.0.1:8080' : '';

  let query = $state('');
  let mode = $state<'search' | 'popular'>('popular');
  let products = $state<PromoCard[]>([]);
  let error = $state('');
  let active = $state(-1);
  let timer = 0;

  async function load(q: string) {
    error = '';
    try {
      const res = await fetch(`/api/lookup.json?q=${encodeURIComponent(q)}`);
      if (!res.ok) {
        error = 'Nie udało się wyszukać produktów.';
        products = [];
        return;
      }
      const body = (await res.json()) as { mode: 'search' | 'popular'; products: PromoCard[] };
      mode = body.mode;
      products = body.products;
      active = -1;
    } catch {
      error = 'API jest niedostępne.';
      products = [];
    }
  }

  function onInput(event: Event) {
    const value = (event.currentTarget as HTMLInputElement).value;
    query = value;
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      void load(value.trim());
    }, 150);
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter') return;
    if (!products.length) return;
    if (event.key === 'Enter') {
      if (active < 0) return;
      event.preventDefault();
      location.href = `${legacy}/products/${products[active]!.id}`;
      return;
    }
    event.preventDefault();
    const next = event.key === 'ArrowDown' ? active + 1 : active - 1;
    active = (next + products.length) % products.length;
  }

  $effect(() => {
    void load('');
  });
</script>

<svelte:head>
  <title>Czy to promka · Bulkly</title>
</svelte:head>

<div class="flex flex-col gap-8">
  <div class="flex flex-col gap-3">
    <h1 class="text-3xl font-semibold tracking-tight">Czy to promka?</h1>
    <p class="text-muted-foreground">Szukaj produktu i sprawdź, czy dzisiejsza cena to prawdziwa Promocja</p>
    <form class="relative" onsubmit={(event) => event.preventDefault()}>
      <label class="sr-only" for="q">Szukaj produktu</label>
      <SearchIcon class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
      <Input id="q" name="q" type="search" value={query} class="pl-8" autocomplete="off" autofocus oninput={onInput} onkeydown={onKeydown} />
    </form>
  </div>

  {#if error}
    <Alert.Root variant="destructive">
      <Alert.Description>{error}</Alert.Description>
    </Alert.Root>
  {:else if mode === 'search'}
    {#if products.length}
      <section class="flex flex-col gap-3">
        <h2 class="text-sm font-medium">Wyniki</h2>
        <ul class="grid gap-3">
          {#each products as card, index (card.id)}
            {@render promo(card, index)}
          {/each}
        </ul>
      </section>
    {:else}
      <Empty.Root class="border">
        <Empty.Header>
          <Empty.Title>Brak pasujących produktów.</Empty.Title>
        </Empty.Header>
      </Empty.Root>
    {/if}
  {:else if products.length}
    <section class="flex flex-col gap-3">
      <h2 class="text-sm font-medium">Popularne teraz</h2>
      <ul class="grid gap-3">
        {#each products as card, index (card.id)}
          {@render promo(card, index)}
        {/each}
      </ul>
    </section>
  {:else}
    <Empty.Root class="border">
      <Empty.Header>
        <Empty.Description>Na liście nic jeszcze nie ma. Zeskanuj paragon w panelu, żeby zacząć.</Empty.Description>
      </Empty.Header>
    </Empty.Root>
  {/if}
</div>

{#snippet promo(card: PromoCard, index: number)}
  <li>
    <a href="{legacy}/products/{card.id}" class="block rounded-xl {index === active ? 'ring-ring ring-2' : ''}">
      <Card.Root class="transition-colors hover:bg-muted/40">
        <Card.Content class="flex items-start justify-between gap-4">
          <span class="flex min-w-0 items-start gap-3">
            {#if card.image}
              <img class="size-12 rounded-lg object-cover" src={card.image} alt="" />
            {:else}
              <span class="bg-muted flex size-12 items-center justify-center rounded-lg text-sm font-medium" aria-hidden="true">{card.initial}</span>
            {/if}
            <span class="min-w-0">
              <span class="block font-medium">{card.name}</span>
              {#if card.now}
                <span class="block text-sm">{card.now}</span>
                {#each card.extras as extra}
                  <span class="text-muted-foreground block text-sm">{extra.price} / {extra.unitName}</span>
                {/each}
              {:else}
                <span class="text-muted-foreground block text-sm">Brak ceny</span>
              {/if}
            </span>
          </span>
          {#if card.priceNote}
            <span class="text-muted-foreground shrink-0 text-sm">{card.priceNote}</span>
          {/if}
        </Card.Content>
      </Card.Root>
    </a>
  </li>
{/snippet}
