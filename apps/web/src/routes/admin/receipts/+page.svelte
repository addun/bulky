<script lang="ts">
  import Notice from '$lib/admin/Notice.svelte';
  import { onMount } from 'svelte';
  import { bindFileDrop, bindPasteImage, firstMatching, isBillFile, pasteFailMessage, putFile, readClipboardImage } from '$lib/admin/files';
  import * as Alert from '$lib/components/ui/alert/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Empty from '$lib/components/ui/empty/index.js';
  import * as Field from '$lib/components/ui/field/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { formatDate } from '$lib/format';
  import { resourceView, arr, obj, text } from '$lib/admin/view';
  let { data, form } = $props();
  const props = $derived({
    receipts: data.receipts,
    configured: data.configured,
    model: data.model,
  });

  const view = $derived(resourceView(props));
  const receipts = $derived(arr(view.receipts));
  const ready = $derived(Boolean(view.configured) && text(view.model) !== '');

  let camera = $state<HTMLInputElement | null>(null);
  let file = $state<HTMLInputElement | null>(null);
  let wrap = $state<HTMLDivElement | null>(null);
  let pickedName = $state('');
  let held: File | null = null;

  function currentFile(): File | null {
    return camera?.files?.[0] || file?.files?.[0] || null;
  }

  function show(next: File | null) {
    pickedName = next ? next.name || 'bill' : '';
  }

  function assign(next: File) {
    if (!file || !camera) return;
    if (!isBillFile(next)) {
      file.setCustomValidity('Choose a photo or a PDF of the bill.');
      file.reportValidity();
      return;
    }
    file.setCustomValidity('');
    camera.value = '';
    held = next;
    show(putFile(file, next, 'bill'));
  }

  async function pasteBill() {
    if (!file) return;
    const result = await readClipboardImage();
    if (result.file) {
      assign(result.file);
      return;
    }
    file.setCustomValidity(pasteFailMessage(result.error));
    file.reportValidity();
  }

  function onSubmit(event: SubmitEvent) {
    if (!file) return;
    if (held) putFile(file, held, 'bill');
    if (!currentFile()) {
      event.preventDefault();
      file.setCustomValidity('Choose a photo or a PDF of the bill.');
      file.reportValidity();
      return;
    }
    file.setCustomValidity('');
    const button = (event.currentTarget as HTMLFormElement).querySelector('button[type="submit"]');
    if (button) button.textContent = 'Uploading…';
  }

  onMount(() => {
    const bill = file;
    const shot = camera;
    const drop = wrap;
    if (!bill || !shot || !drop) return;
    const onCamera = () => {
      bill.value = '';
      held = shot.files?.[0] ?? null;
      show(held);
    };
    const onFile = () => {
      shot.value = '';
      held = bill.files?.[0] ?? null;
      show(held);
    };
    shot.addEventListener('change', onCamera);
    bill.addEventListener('change', onFile);
    const offPaste = bindPasteImage(assign);
    const offDrop = bindFileDrop(drop, (files) => {
      const next = firstMatching(files, isBillFile);
      if (!next) {
        bill.setCustomValidity('Choose a photo or a PDF of the bill.');
        bill.reportValidity();
        return;
      }
      assign(next);
    });
    return () => {
      shot.removeEventListener('change', onCamera);
      bill.removeEventListener('change', onFile);
      offPaste();
      offDrop();
    };
  });
</script>

<svelte:head><title>Receipts · Bulkly</title></svelte:head>

<Notice message={form?.message || data.error} />
<div class="flex flex-wrap items-center justify-between gap-3">
  <h1 class="text-2xl font-semibold tracking-tight">Receipts</h1>
  <Button variant="outline" href="/admin/receipts/duplicates">Show duplicates</Button>
</div>

{#if !view.configured}
  <Alert.Root variant="destructive">
    <Alert.Description>The reader is off until you set <code>OCR_API_KEY</code> (OpenAI) or <code>OCR_BASE_URL</code> (any OpenAI-compatible vision API, including a local server).</Alert.Description>
  </Alert.Root>
{/if}
{#if !text(view.model)}
  <Alert.Root variant="destructive">
    <Alert.Description>Set the AI model under <a href="/admin/settings">Settings</a> so the reader can run.</Alert.Description>
  </Alert.Root>
{/if}
{#if ready}
  <form class="flex max-w-xl flex-col gap-4" method="post" action="/admin/receipts" enctype="multipart/form-data" onsubmit={onSubmit}>
    <div class="flex flex-col gap-3 rounded-xl border border-dashed p-4" class:bg-muted={pickedName !== ''} bind:this={wrap}>
      <p class="font-medium">Photo or PDF of the bill</p>
      <p class="text-muted-foreground text-sm">Paste, drop, take a photo, or choose one. jpeg, png, webp, gif or pdf, up to 10 MB.</p>
      <Field.Field>
        <Field.Label for="bill-camera">Take photo</Field.Label>
        <Input id="bill-camera" name="bill_camera" type="file" accept="image/*" capture="environment" bind:this={camera} />
      </Field.Field>
      <Field.Field>
        <Field.Label for="bill">Choose file</Field.Label>
        <Input id="bill" name="bill" type="file" accept="image/*,.pdf,application/pdf" bind:this={file} />
      </Field.Field>
      <Button type="button" variant="outline" class="w-fit" onclick={pasteBill}>Paste</Button>
      {#if pickedName}
        <p class="text-sm">File {pickedName} is ready to upload</p>
      {/if}
    </div>
    <Button type="submit">Read the bill</Button>
  </form>
{/if}

{#if receipts.length === 0}
  <Empty.Root class="border">
    <Empty.Header>
      <Empty.Title>No receipts yet.</Empty.Title>
    </Empty.Header>
  </Empty.Root>
{:else}
  <ul class="divide-y overflow-hidden rounded-xl border">
    {#each receipts as receipt (text(obj(receipt).id))}
      {@const row = obj(receipt)}
      <li>
        <a class="hover:bg-muted/50 flex items-center gap-3 px-3 py-2" href="/admin/receipts/{row.id}">
          <span class="min-w-0">
            <span class="block font-medium">{row.shopName ? text(row.shopName) : formatDate(text(row.displayDate))}</span>
            <span class="text-muted-foreground text-sm">{row.shopName ? `${formatDate(text(row.displayDate))} · ` : ''}{text(row.statusLabel)}</span>
          </span>
        </a>
      </li>
    {/each}
  </ul>
{/if}
