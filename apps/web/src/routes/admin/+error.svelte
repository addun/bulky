<script lang="ts">
  import { page } from '$app/state';
</script>

<h1 class="text-2xl font-semibold tracking-tight">{page.status}</h1>
<p class="text-muted-foreground">{page.error?.message || 'Something went wrong.'}</p>
