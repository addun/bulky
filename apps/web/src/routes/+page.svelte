<script lang="ts">
  type Extra = { price: string; unitName: string };
  type Card = {
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
  let products = $state<Card[]>([]);
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
      const body = (await res.json()) as { mode: 'search' | 'popular'; products: Card[] };
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

<div class="lookup">
  <div class="promo-hero">
    <h1>Czy to promka?</h1>
    <p class="lede">Szukaj produktu i sprawdź, czy dzisiejsza cena to prawdziwa Promocja</p>
    <form class="promo-search" onsubmit={(event) => event.preventDefault()}>
      <label class="sr" for="q">Szukaj produktu</label>
      <span class="promo-search-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="6.25" fill="none" stroke="currentColor" stroke-width="1.8" />
          <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="m16.2 16.2 4.1 4.1" />
        </svg>
      </span>
      <input id="q" name="q" type="search" value={query} autocomplete="off" autofocus oninput={onInput} onkeydown={onKeydown} />
    </form>
  </div>

  {#if error}
    <p class="empty">{error}</p>
  {:else if mode === 'search'}
    {#if products.length}
      <h2 class="promo-kicker">Wyniki</h2>
      <ul class="promo-grid">
        {#each products as card, index (card.id)}
          {@render promo(card, index)}
        {/each}
      </ul>
    {:else}
      <p class="empty">Brak pasujących produktów.</p>
    {/if}
  {:else if products.length}
    <h2 class="promo-kicker">Popularne teraz</h2>
    <ul class="promo-grid">
      {#each products as card, index (card.id)}
        {@render promo(card, index)}
      {/each}
    </ul>
  {:else}
    <p class="empty">Na liście nic jeszcze nie ma. Zeskanuj paragon w panelu, żeby zacząć.</p>
  {/if}
</div>

{#snippet promo(card: Card, index: number)}
  <li>
    <a class="promo-card" class:is-current={index === active} href="{legacy}/products/{card.id}">
      <span class="promo-main">
        {#if card.image}
          <img class="promo-thumb" src={card.image} alt="" />
        {:else}
          <span class="promo-icon is-{card.tint}" aria-hidden="true">{card.initial}</span>
        {/if}
        <span class="promo-body">
          <strong class="promo-name">{card.name}</strong>
          {#if card.now}
            <span class="promo-now">{card.now}</span>
            {#each card.extras as extra}
              <span class="promo-alt">{extra.price} / {extra.unitName}</span>
            {/each}
          {:else}
            <span class="promo-now">Brak ceny</span>
          {/if}
        </span>
      </span>
      {#if card.priceNote}
        <span class="promo-note">{card.priceNote}</span>
      {/if}
    </a>
  </li>
{/snippet}
