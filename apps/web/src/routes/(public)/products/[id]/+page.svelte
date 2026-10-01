<script lang="ts">
  import { page } from '$app/state';
  import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
  import * as Alert from '$lib/components/ui/alert/index.js';
  import * as Card from '$lib/components/ui/card/index.js';
  import * as Empty from '$lib/components/ui/empty/index.js';
  import PriceChart from '$lib/PriceChart.svelte';

  type Extra = { price: string; unitName: string };
  type PromoCard = {
    id: number;
    name: string;
    image: string;
    initial: string;
    now: string;
    extras: Extra[];
    priceNote: string;
  };
  type ProductPage = {
    id: number;
    name: string;
    image: string;
    initial: string;
    priceEyebrow: string;
    priceNote: string;
    now: string;
    extras: Extra[];
    stats: { label: string; value: string }[];
    chart: { points: { on: string; price: string }[]; from: string; to: string; symbol: string } | null;
    related: PromoCard[];
  };

  let product = $state<ProductPage | null>(null);
  let error = $state('');
  let missing = $state(false);

  async function load(id: string) {
    error = '';
    missing = false;
    product = null;
    try {
      const res = await fetch(`/api/lookup/${encodeURIComponent(id)}`);
      if (res.status === 404) {
        missing = true;
        return;
      }
      if (!res.ok) {
        error = 'Nie udało się wczytać produktu.';
        return;
      }
      product = (await res.json()) as ProductPage;
    } catch {
      error = 'API jest niedostępne.';
    }
  }

  $effect(() => {
    const id = page.params.id ?? '';
    if (id) void load(id);
  });
</script>

<svelte:head>
  <title>{product?.name ?? 'Produkt'} · Bulkly</title>
</svelte:head>

<div class="flex flex-col gap-8">
  <a class="text-muted-foreground inline-flex items-center gap-1 text-sm" href="/">
    <ArrowLeftIcon class="size-4" />
    Szukaj
  </a>

  {#if error}
    <Alert.Root variant="destructive">
      <Alert.Description>{error}</Alert.Description>
    </Alert.Root>
  {:else if missing}
    <Empty.Root class="border">
      <Empty.Header>
        <Empty.Title>Nie znaleziono produktu.</Empty.Title>
      </Empty.Header>
    </Empty.Root>
  {:else if product}
    <article class="flex items-center gap-4">
      {#if product.image}
        <img class="size-16 rounded-xl object-cover" src={product.image} alt="" />
      {:else}
        <span class="bg-muted flex size-16 items-center justify-center rounded-xl text-lg font-medium" aria-hidden="true">{product.initial}</span>
      {/if}
      <h1 class="text-3xl font-semibold tracking-tight">{product.name}</h1>
    </article>

    <section class="flex flex-col gap-1">
      <p class="text-muted-foreground text-sm">{product.priceEyebrow || 'Najlepsza cena, ostatnie 30 dni'}</p>
      {#if product.now}
        <p class="text-2xl font-semibold tabular-nums">{product.now}</p>
        {#each product.extras as extra}
          <p class="text-muted-foreground text-sm">{extra.price} / {extra.unitName}</p>
        {/each}
        {#if product.priceNote}
          <p class="text-muted-foreground text-sm">{product.priceNote}</p>
        {/if}
      {:else}
        <p class="text-2xl font-semibold">—</p>
      {/if}
    </section>

    {#if product.stats.length}
      <section class="flex flex-col gap-2">
        {#each product.stats as stat}
          <div class="flex items-baseline gap-3 text-sm">
            <span>{stat.label}</span>
            <span class="border-border min-w-4 flex-1 border-b border-dotted"></span>
            <span class="tabular-nums">{stat.value}</span>
          </div>
        {/each}
      </section>
    {/if}

    <section class="flex flex-col gap-3">
      <h2 class="text-sm font-medium">Historia cen</h2>
      {#if product.chart}
        <PriceChart points={product.chart.points} from={product.chart.from} to={product.chart.to} symbol={product.chart.symbol} />
      {:else}
        <p class="text-muted-foreground text-sm">Brak cen z ostatniego roku.</p>
      {/if}
    </section>

    {#if product.related.length}
      <section class="flex flex-col gap-3">
        <h2 class="text-sm font-medium">Podobne produkty</h2>
        <ul class="grid gap-3">
          {#each product.related as card (card.id)}
            <li>
              <a href="/products/{card.id}" class="block rounded-xl">
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
          {/each}
        </ul>
      </section>
    {/if}
  {/if}
</div>
