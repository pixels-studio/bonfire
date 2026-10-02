<script lang="ts">
  import '../app.css';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import Toast from '$lib/components/ui/toast/toast.svelte';
  let { children } = $props();
</script>

<Tooltip.Provider>
  {@render children()}
</Tooltip.Provider>
<Toast />
