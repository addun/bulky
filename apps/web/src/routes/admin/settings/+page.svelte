<script lang="ts">
  import Notice from '$lib/admin/Notice.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Card from '$lib/components/ui/card/index.js';
  import * as Field from '$lib/components/ui/field/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import * as NativeSelect from '$lib/components/ui/native-select/index.js';
  import { resourceView, arr, obj, text } from '$lib/admin/view';
  let { data, form } = $props();
  const props = $derived({
    ocrModel: form?.ocrModel ?? data.ocrModel,
    units: data.units,
    defaults: form?.defaults ?? data.defaults,
  });

  const view = $derived(resourceView(props));
  const units = $derived(arr(view.units));
  const defaults = $derived(obj(view.defaults));
</script>

<svelte:head><title>Settings · Bulkly</title></svelte:head>

<Notice message={form?.message} />
<h1 class="text-2xl font-semibold tracking-tight">Settings</h1>
<form method="post" action="/admin/settings">
  <Field.Group class="max-w-xl">
    <Field.Field>
      <Field.Label for="ocr-model">Model <span class="text-destructive">*</span></Field.Label>
      <Input id="ocr-model" name="ocr_model" required value={text(view.ocrModel)} autofocus />
      <Field.Description>
        <a href="https://developers.openai.com/api/docs/models/all" target="_blank" rel="noopener">All models</a>
      </Field.Description>
    </Field.Field>
    <Field.Set>
      <Field.Legend>New product units</Field.Legend>
      <Field.Description>On a bill, a quantity like 1 uses the piece unit and 1,450 uses the weight unit. <a href="/admin/units">Add units</a> first if the list is empty.</Field.Description>
      <div class="grid gap-4 sm:grid-cols-2">
        <Field.Field>
          <Field.Label for="piece-unit">Piece unit <span class="text-destructive">*</span></Field.Label>
          <NativeSelect.Root id="piece-unit" class="w-full" name="piece_unit_id" required value={text(defaults.pieceId)}>
            <NativeSelect.Option value="">Select…</NativeSelect.Option>
            {#each units as unit (text(obj(unit).id))}
              {@const row = obj(unit)}
              <NativeSelect.Option value={text(row.id)}>{text(row.name)}</NativeSelect.Option>
            {/each}
          </NativeSelect.Root>
        </Field.Field>
        <Field.Field>
          <Field.Label for="weight-unit">Weight unit <span class="text-destructive">*</span></Field.Label>
          <NativeSelect.Root id="weight-unit" class="w-full" name="weight_unit_id" required value={text(defaults.weightId)}>
            <NativeSelect.Option value="">Select…</NativeSelect.Option>
            {#each units as unit (text(obj(unit).id))}
              {@const row = obj(unit)}
              <NativeSelect.Option value={text(row.id)}>{text(row.name)}</NativeSelect.Option>
            {/each}
          </NativeSelect.Root>
        </Field.Field>
      </div>
    </Field.Set>
    <Button type="submit">Save</Button>
  </Field.Group>
</form>

<Card.Root class="max-w-xl">
  <Card.Header>
    <Card.Title>MCP</Card.Title>
    <Card.Description>Agents connect at <code>/mcp</code> on this host. No token.</Card.Description>
  </Card.Header>
  <Card.Content>
    <pre class="bg-muted overflow-x-auto rounded-lg p-3 text-sm">{`{
  "mcpServers": {
    "bulkly": {
      "url": "https://YOUR_HOST/mcp"
    }
  }
}`}</pre>
  </Card.Content>
</Card.Root>
