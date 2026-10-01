<script lang="ts">
  import '../app.css';

  let { children } = $props();
</script>

<div class="flex min-h-svh flex-col">
  {@render children()}
</div>
