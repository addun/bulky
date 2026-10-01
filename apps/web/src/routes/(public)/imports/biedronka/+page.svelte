<script lang="ts">
  import { onMount } from 'svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Field from '$lib/components/ui/field/index.js';
  import * as Table from '$lib/components/ui/table/index.js';
  import { Textarea } from '$lib/components/ui/textarea/index.js';
  import { BiedronkaImport, HINT_HELPER, HINT_PASTE, formatBillDate, formatBillMoney } from '$lib/biedronka.svelte';

  const client = new BiedronkaImport();
  let code = $state('');

  onMount(() => {
    const root = document.documentElement;
    client.setHelper(root.dataset.bulklyBiedronkaExt === '1');
    const onRedirect = () => {
      const url = root.getAttribute('data-bulkly-biedronka-redirect') || '';
      root.removeAttribute('data-bulkly-biedronka-redirect');
      if (!url) return;
      code = url;
      client.redirectFilled();
    };
    root.addEventListener('bulkly-biedronka-redirect', onRedirect);
    void client.loadImported();
    return () => root.removeEventListener('bulkly-biedronka-redirect', onRedirect);
  });

  async function signIn() {
    const url = await client.startSignIn();
    code = '';
    const opened = window.open(url, '_blank');
    if (!opened) client.popupBlocked();
  }

  async function finish() {
    const result = await client.finishSignIn(code);
    if (result === 'clear') code = '';
  }
</script>

<svelte:head>
  <title>Biedronka import · Bulkly</title>
</svelte:head>

<div class="flex flex-col gap-6">
  <div class="flex flex-col gap-2">
    <h1 class="text-3xl font-semibold tracking-tight">Biedronka import</h1>
    <p class="text-muted-foreground max-w-2xl">Import e-bills from Moja Biedronka as saved purchases. Already imported bills are skipped. Tokens stay in this page, not in the database.</p>
  </div>

  {#if !client.signedIn}
    <div class="flex flex-col gap-4">
      <div>
        <Button type="button" onclick={signIn}>Sign in with Moja Biedronka</Button>
      </div>
      <Field.Field>
        <Field.Label for="biedronka-code">Auth URL</Field.Label>
        <Textarea id="biedronka-code" rows={3} spellcheck={false} autocapitalize="off" autocomplete="off" bind:value={code} />
        <Field.Description>{client.helper ? HINT_HELPER : HINT_PASTE}</Field.Description>
      </Field.Field>
      <div>
        <Button type="button" disabled={client.busy} onclick={finish}>Finish sign-in</Button>
      </div>
    </div>
  {:else}
    <div class="flex flex-col gap-3">
      {#if client.session}
        <p class="text-muted-foreground text-sm">{client.session}</p>
      {/if}
      <div>
        <Button type="button" variant="outline" onclick={() => client.signOut()}>Sign out</Button>
      </div>
    </div>
  {/if}

  {#if client.status}
    <p class="text-muted-foreground text-sm">{client.status}</p>
  {/if}

  {#if client.results}
    <section class="flex flex-col gap-3">
      <div class="flex items-center justify-between gap-3">
        <h2 class="text-lg font-medium">Bills</h2>
        <Button type="button" disabled={client.importing || client.busy || client.importable === 0} onclick={() => client.importAll()}>Import all</Button>
      </div>
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head>Date</Table.Head>
            <Table.Head>Store</Table.Head>
            <Table.Head>Total</Table.Head>
            <Table.Head></Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#if client.rows.length === 0}
            <Table.Row>
              <Table.Cell colspan={4} class="text-muted-foreground">{client.empty || 'No bills.'}</Table.Cell>
            </Table.Row>
          {:else}
            {#each client.rows as tx, index (tx.id ?? index)}
              <Table.Row>
                <Table.Cell>{formatBillDate(tx.date)}</Table.Cell>
                <Table.Cell>{tx.store_name || ''}</Table.Cell>
                <Table.Cell class="tabular-nums">{formatBillMoney(tx.total_price)}</Table.Cell>
                <Table.Cell>
                  {#if client.canImport(tx)}
                    <Button type="button" variant="outline" disabled={client.importing || client.busy} onclick={() => client.importOne(tx)}>Import</Button>
                  {:else}
                    {client.label(tx)}
                  {/if}
                </Table.Cell>
              </Table.Row>
            {/each}
          {/if}
        </Table.Body>
      </Table.Root>
      {#if client.more}
        <div>
          <Button type="button" variant="outline" disabled={client.busy} onclick={() => client.loadBills(false)}>Load more</Button>
        </div>
      {/if}
    </section>
  {/if}
</div>
