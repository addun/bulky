<script lang="ts">
  import { onMount } from 'svelte';
  import { bindFileDrop, bindPasteImage, firstMatching, isImageFile, pasteFailMessage, putFile, readClipboardImage } from '$lib/admin/files';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import * as Field from '$lib/components/ui/field/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import * as NativeSelect from '$lib/components/ui/native-select/index.js';
  import { formatQty } from '$lib/format';
  import { resourceView, arr, flag, obj, text } from '$lib/admin/view';

  let props = $props();
  const view = $derived(resourceView(props));
  const isNew = $derived(flag(view['new']));
  const product = $derived(obj(view.product));
  const units = $derived(arr(view.units));
  const groups = $derived(arr(view.groups));
  const action = $derived(isNew ? '/admin/products/new' : `/admin/products/${text(product.id)}/edit`);
  const imagePath = $derived(text(product.imagePath));

  type Extra = { unitId: string; factor: string };
  const initial = obj(view.product);
  let name = $state(text(initial.name));
  let ean = $state(text(initial.ean));
  let unitId = $state(text(initial.unitId));
  let extras = $state<Extra[]>(
    arr(initial.conversions).map((row) => {
      const extra = obj(row);
      return { unitId: text(extra.unitId), factor: formatQty(text(extra.factor)) };
    }),
  );
  let groupOn = $state<Record<string, boolean>>(
    Object.fromEntries(arr(view.groups).map((row) => [text(obj(row).id), obj(row).selected === true])),
  );
  let hasFile = $state(Boolean(text(initial.imagePath)));
  let heldPhoto: File | null = null;
  let photoInput = $state<HTMLInputElement | null>(null);
  let photoImg = $state<HTMLImageElement | null>(null);
  let photoWrap = $state<HTMLDivElement | null>(null);
  let clearPhoto = $state(false);

  const unitName = $derived.by(() => {
    if (!isNew && text(product.unitName)) return text(product.unitName);
    const picked = units.map(obj).find((unit) => text(unit.id) === unitId);
    return picked ? text(picked.name) : 'base unit';
  });

  function addExtra() {
    extras.push({ unitId: '', factor: '' });
  }

  function removeExtra(index: number) {
    extras.splice(index, 1);
  }

  function showPhoto(file: File) {
    heldPhoto = file;
    if (photoImg) {
      photoImg.src = URL.createObjectURL(file);
    }
    hasFile = true;
    clearPhoto = false;
  }

  function takePhoto(file: File) {
    if (!photoInput) return;
    if (!isImageFile(file)) {
      photoInput.setCustomValidity('Choose a jpeg, png, webp, or gif.');
      photoInput.reportValidity();
      return;
    }
    photoInput.setCustomValidity('');
    showPhoto(putFile(photoInput, file, 'paste'));
  }

  async function pastePhoto() {
    if (!photoInput) return;
    const result = await readClipboardImage();
    if (result.file) {
      takePhoto(result.file);
      return;
    }
    photoInput.setCustomValidity(pasteFailMessage(result.error));
    photoInput.reportValidity();
  }

  function onSubmit() {
    if (heldPhoto && photoInput) putFile(photoInput, heldPhoto, 'paste');
  }

  onMount(() => {
    const input = photoInput;
    const wrap = photoWrap;
    if (!input || !wrap) return;
    const onChange = () => {
      const file = input.files?.[0];
      if (file) showPhoto(file);
    };
    input.addEventListener('change', onChange);
    const offPaste = bindPasteImage(takePhoto);
    const offDrop = bindFileDrop(wrap, (files) => {
      const file = firstMatching(files, isImageFile);
      if (file) takePhoto(file);
    });
    return () => {
      input.removeEventListener('change', onChange);
      offPaste();
      offDrop();
    };
  });
</script>

<h1 class="text-2xl font-semibold tracking-tight">{isNew ? 'Add product' : `Edit ${text(product.name)}`}</h1>
<form method="post" {action} enctype="multipart/form-data" id="product-form" onsubmit={onSubmit}>
  <Field.Group class="max-w-2xl">
    <Field.Field>
      <Field.Label for="name">Name <span class="text-destructive">*</span></Field.Label>
      <Input id="name" name="name" required bind:value={name} autofocus />
    </Field.Field>
    <Field.Field>
      <Field.Label for="ean">EAN</Field.Label>
      <Input id="ean" name="ean" bind:value={ean} inputmode="numeric" autocomplete="off" />
    </Field.Field>
    {#if isNew}
      <Field.Field>
        <Field.Label for="purchase-unit">Base unit <span class="text-destructive">*</span></Field.Label>
        <NativeSelect.Root id="purchase-unit" class="w-full" name="unit_id" required bind:value={unitId}>
          <NativeSelect.Option value="">Select…</NativeSelect.Option>
          {#each units as unit (text(obj(unit).id))}
            {@const row = obj(unit)}
            <NativeSelect.Option value={text(row.id)}>{text(row.name)}</NativeSelect.Option>
          {/each}
        </NativeSelect.Root>
      </Field.Field>
      {#if units.length === 0}
        <Field.Description>No units yet. <a href="/admin/units">Add a unit</a> first.</Field.Description>
      {/if}
    {:else}
      <input type="hidden" name="unit_id" value={text(product.unitId)} />
      <p class="text-sm">Purchase unit <strong>{text(product.unitName)}</strong> · <a class="underline underline-offset-4" href="/admin/products/{product.id}/change-unit">Change unit</a></p>
    {/if}

    <Field.Set>
      <Field.Legend>Conversions</Field.Legend>
      {#each extras as extra, index (index)}
        <div class="flex flex-wrap items-end gap-2">
          <p class="pb-2 text-sm">1 {unitName} equals</p>
          <Field.Field class="w-28">
            <Field.Label class="sr-only" for="factor-{index}">Conversion amount</Field.Label>
            <Input id="factor-{index}" name="extra_factor" inputmode="decimal" bind:value={extra.factor} aria-label="Conversion amount" />
          </Field.Field>
          <Field.Field class="min-w-36 flex-1">
            <Field.Label class="sr-only" for="extra-unit-{index}">Conversion unit</Field.Label>
            <NativeSelect.Root id="extra-unit-{index}" class="w-full" name="extra_unit_id" bind:value={extra.unitId} aria-label="Conversion unit">
              <NativeSelect.Option value="">Select…</NativeSelect.Option>
              {#each units as unit (text(obj(unit).id))}
                {@const row = obj(unit)}
                <NativeSelect.Option value={text(row.id)}>{text(row.name)}</NativeSelect.Option>
              {/each}
            </NativeSelect.Root>
          </Field.Field>
          <Button type="button" variant="ghost" onclick={() => removeExtra(index)}>Remove</Button>
        </div>
      {/each}
      <Button type="button" variant="outline" onclick={addExtra}>Add conversion</Button>
    </Field.Set>

    {#if groups.length > 0}
      <Field.Set>
        <Field.Legend>Comparison groups</Field.Legend>
        <Field.Description>Same brand, whole market, or any other set. Ranked by latest price per the group’s unit.</Field.Description>
        <div class="flex flex-col gap-3">
          {#each groups as group (text(obj(group).id))}
            {@const row = obj(group)}
            {@const id = text(row.id)}
            <Field.Field orientation="horizontal">
              <Checkbox id="group-{id}" name="group_id" value={id} bind:checked={groupOn[id]} />
              <Field.Label for="group-{id}">{text(row.name)} <span class="text-muted-foreground">{text(row.unitName)}</span></Field.Label>
            </Field.Field>
          {/each}
        </div>
      </Field.Set>
    {/if}

    <div class="flex flex-col gap-3 rounded-xl border border-dashed p-4" class:bg-muted={hasFile} bind:this={photoWrap}>
      <Field.Field>
        <Field.Label for="product-image">Photo</Field.Label>
        <Input id="product-image" name="image" type="file" accept="image/*" bind:this={photoInput} />
        <Field.Description>Paste or drop a jpeg, png, webp, or gif.</Field.Description>
      </Field.Field>
      <Button type="button" variant="outline" class="w-fit" onclick={pastePhoto}>Paste</Button>
      <div class="flex items-center gap-3">
        <img class="bg-muted size-16 rounded-lg object-cover" alt="" bind:this={photoImg} src={imagePath ? `/images/${imagePath}` : undefined} />
        {#if !isNew && imagePath}
          <Field.Field orientation="horizontal">
            <Checkbox id="clear-image" name="clear_image" value="1" bind:checked={clearPhoto} />
            <Field.Label for="clear-image">Remove photo</Field.Label>
          </Field.Field>
        {/if}
      </div>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <Button type="submit">{isNew ? 'Save product' : 'Save changes'}</Button>
      <Button variant="outline" href={isNew ? '/admin' : `/admin/products/${text(product.id)}`}>Cancel</Button>
    </div>
  </Field.Group>
</form>
