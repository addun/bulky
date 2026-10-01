<script lang="ts">
  import QtyTotal from '$lib/admin/QtyTotal.svelte';
  import * as Alert from '$lib/components/ui/alert/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import * as Field from '$lib/components/ui/field/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import * as NativeSelect from '$lib/components/ui/native-select/index.js';
  import { toDatetimeLocal } from '$lib/format';
  import { resourceView, arr, num, obj, text } from '$lib/admin/view';

  type Line = {
    include: boolean;
    productId: number;
    productName: string;
    unitId: number;
    quantity: string;
    amount: string;
    receiptName: string;
    vatType: string;
    unitPrice: string;
    discount: string;
    ean: string;
  };

  let props = $props();
  const view = $derived(resourceView(props));
  const bill = $derived(obj(view.view));
  const products = $derived(arr(view.products).map(obj));
  const units = $derived(arr(view.units).map(obj));
  const stores = $derived(arr(view.stores).map(obj));
  const symbol = $derived(text(view.page.symbol));
  const currency = $derived(text(view.page.currency));

  const initial = obj(view.view);
  let boughtOn = $state(toDatetimeLocal(text(initial.boughtOn)));
  let storeId = $state(num(initial.storeId) ? text(initial.storeId) : '');
  let lines = $state<Line[]>(
    arr(initial.lines).map((row) => {
      const line = obj(row);
      return {
        include: line.include !== false,
        productId: num(line.productId),
        productName: text(line.productName),
        unitId: num(line.unitId),
        quantity: text(line.quantity),
        amount: text(line.amount),
        receiptName: text(line.receiptName),
        vatType: text(line.vatType),
        unitPrice: text(line.unitPrice),
        discount: text(line.discount),
        ean: text(line.ean),
      };
    }),
  );

  function choose(line: Line, value: string) {
    line.productId = value === 'new' || value === '' ? 0 : Number(value);
    line.unitId = 0;
  }

  function addLine() {
    lines.push({
      include: true,
      productId: 0,
      productName: '',
      unitId: 0,
      quantity: '',
      amount: '',
      receiptName: '',
      vatType: '',
      unitPrice: '',
      discount: '',
      ean: '',
    });
  }

  function unitName(line: Line): string {
    if (line.productId) return '';
    return text(units.find((unit) => num(unit.id) === line.unitId)?.name);
  }
</script>

<div class="flex flex-col gap-1">
  <h1 class="text-2xl font-semibold tracking-tight">Confirm the bill</h1>
  <p class="text-muted-foreground">Products from this bill. Check each line, then save as purchases.</p>
</div>

{#if bill.migrated}
  <Alert.Root>
    <Alert.Description>This bill is already saved as purchases.</Alert.Description>
  </Alert.Root>
{/if}
{#if bill.notes}
  <Alert.Root>
    <Alert.Description>{text(bill.notes)}</Alert.Description>
  </Alert.Root>
{/if}

<div class="grid items-start gap-6 lg:grid-cols-[16rem_1fr]">
  {#if bill.imagePath}
    <img class="w-full rounded-xl border" src="/admin/receipts/{bill.receiptId}/preview" alt="Uploaded bill" />
  {/if}

  <div class="flex flex-col gap-4">
    <form method="post" action="/admin/receipts/{bill.receiptId}">
      <Field.Group>
        <input type="hidden" name="receipt_id" value={text(bill.receiptId)} />
        <input type="hidden" name="image_path" value={text(bill.imagePath)} />
        <input type="hidden" name="notes" value={text(bill.notes)} />
        <input type="hidden" name="line_count" value={lines.length} />

        <Field.Set>
          <Field.Legend>Visit</Field.Legend>
          <Field.Field>
            <Field.Label for="bought-on">Date and hour <span class="text-destructive">*</span></Field.Label>
            <Input id="bought-on" type="datetime-local" name="bought_on" required bind:value={boughtOn} />
          </Field.Field>
          <Field.Field>
            <Field.Label for="store">Store</Field.Label>
            <NativeSelect.Root id="store" class="w-full" name="store_id" bind:value={storeId}>
              <NativeSelect.Option value="">None</NativeSelect.Option>
              {#each stores as store (text(store.id))}
                <NativeSelect.Option value={text(store.id)}>{text(store.label)}</NativeSelect.Option>
              {/each}
            </NativeSelect.Root>
          </Field.Field>
          {#if bill.addressLine}<Field.Description>Address on the bill: {text(bill.addressLine)}</Field.Description>{/if}
          {#if bill.createStoreUrl}<Button variant="outline" class="w-fit" href={text(bill.createStoreUrl)}>Create store</Button>{/if}
          {#if stores.length === 0 && !bill.createStoreUrl}<Field.Description>No stores yet. You can still save, or <a href="/admin/stores/new">add a store</a> first.</Field.Description>{/if}
          <input type="hidden" name="store_name" value={text(bill.storeName)} />
          <input type="hidden" name="external_id" value={text(bill.externalId)} />
          <input type="hidden" name="street_name" value={text(bill.streetName)} />
          <input type="hidden" name="building_number" value={text(bill.buildingNumber)} />
          <input type="hidden" name="apartment_number" value={text(bill.apartmentNumber)} />
          <input type="hidden" name="postal_code" value={text(bill.postalCode)} />
          <input type="hidden" name="city" value={text(bill.city)} />
        </Field.Set>

        <h2 class="text-lg font-semibold tracking-tight">Products</h2>
        {#each lines as line, index (index)}
          <Field.Set class={!line.include ? 'opacity-50' : ''}>
            <Field.Legend class="sr-only">Line {index + 1}</Field.Legend>
            <Field.Field orientation="horizontal">
              <Checkbox id="include-{index}" name="include_{index}" value="1" bind:checked={line.include} />
              <Field.Label for="include-{index}">Include</Field.Label>
            </Field.Field>
            {#if line.receiptName || line.vatType || line.unitPrice || line.discount}
              <p class="text-muted-foreground text-sm">On the bill: {line.receiptName}{#if line.vatType} · VAT {line.vatType}{/if}{#if line.unitPrice} · {line.quantity} × {line.unitPrice}{/if}{#if line.discount} · rabat {line.discount}{/if}</p>
            {/if}
            <input type="hidden" name="vat_type_{index}" value={line.vatType} />
            <input type="hidden" name="unit_price_{index}" value={line.unitPrice} />
            <input type="hidden" name="discount_{index}" value={line.discount} />
            <input type="hidden" name="ean_{index}" value={line.ean} />
            <Field.Field>
              <Field.Label for="alias-{index}">Alias</Field.Label>
              <Input id="alias-{index}" name="receipt_name_{index}" bind:value={line.receiptName} />
            </Field.Field>
            <Field.Field>
              <Field.Label for="product-{index}">Product</Field.Label>
              <NativeSelect.Root
                id="product-{index}"
                class="w-full"
                name="product_choice_{index}"
                value={line.productId ? String(line.productId) : 'new'}
                onchange={(event) => choose(line, event.currentTarget.value)}
              >
                <NativeSelect.Option value="new">New product</NativeSelect.Option>
                {#each products as product (text(product.id))}
                  <NativeSelect.Option value={text(product.id)}>{text(product.name)} ({text(product.unitName)})</NativeSelect.Option>
                {/each}
              </NativeSelect.Root>
            </Field.Field>
            {#if line.productId === 0}
              <Field.Field>
                <Field.Label for="product-name-{index}">Name</Field.Label>
                <Input id="product-name-{index}" name="product_name_{index}" bind:value={line.productName} />
              </Field.Field>
            {:else}
              <input type="hidden" name="product_name_{index}" value={line.productName} />
            {/if}
            <div class="grid gap-4 sm:grid-cols-3">
              <Field.Field>
                <Field.Label for="qty-{index}">Quantity</Field.Label>
                <Input id="qty-{index}" name="quantity_{index}" inputmode="decimal" bind:value={line.quantity} />
              </Field.Field>
              <Field.Field class={line.productId === 0 ? '' : 'hidden'}>
                <Field.Label for="unit-{index}">Unit</Field.Label>
                <NativeSelect.Root
                  id="unit-{index}"
                  class="w-full"
                  name="unit_id_{index}"
                  value={line.unitId ? String(line.unitId) : ''}
                  onchange={(event) => {
                    line.unitId = Number(event.currentTarget.value) || 0;
                  }}
                >
                  <NativeSelect.Option value="">Select…</NativeSelect.Option>
                  {#each units as unit (text(unit.id))}
                    <NativeSelect.Option value={text(unit.id)}>{text(unit.name)}</NativeSelect.Option>
                  {/each}
                </NativeSelect.Root>
              </Field.Field>
              <Field.Field>
                <Field.Label for="amount-{index}">Amount ({currency})</Field.Label>
                <Input id="amount-{index}" name="amount_{index}" inputmode="decimal" bind:value={line.amount} />
              </Field.Field>
            </div>
            <QtyTotal quantity={line.quantity} amount={line.amount} unit={unitName(line)} {symbol} />
          </Field.Set>
        {/each}
        {#if !bill.migrated}
          <Button type="button" variant="outline" class="w-fit" onclick={addLine}>Add a product</Button>
          <Button type="submit" class="w-fit">Save purchases</Button>
        {/if}
      </Field.Group>
    </form>
    <Button variant="destructive" class="w-fit" href="/admin/receipts/{bill.receiptId}/delete">Delete receipt</Button>
  </div>
</div>
