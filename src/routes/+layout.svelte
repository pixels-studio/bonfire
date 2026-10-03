<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import Toast from '$lib/components/ui/toast/toast.svelte';
  import { applyAccent } from '$lib/accent';
  import { preferences } from '$lib/stores/preferences.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { errorMessage } from '$shared/domain';
  let { children } = $props();

  $effect(() => applyAccent(preferences.current.accentHue));

  onMount(() => {
    preferences
      .load()
      .catch((cause) => toast(errorMessage(cause), { variant: 'error' }));
  });
</script>

<Tooltip.Provider>
  {@render children()}
</Tooltip.Provider>
<Toast />
