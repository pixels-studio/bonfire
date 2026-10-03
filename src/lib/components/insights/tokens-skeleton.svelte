<!-- Mirrors the sections of the tokens tab, so the content replaces it without shifting. -->
<script lang="ts">
  let { part }: { part: 'stats' | 'rest' } = $props();

  const BAR = 'rounded-[3px] bg-secondary';
</script>

{#if part === 'stats'}
  <div
    aria-busy="true"
    class="grid animate-pulse grid-cols-3 gap-x-4 gap-y-5 motion-reduce:animate-none"
  >
    {#each { length: 5 } as _, cell (cell)}
      <div class="flex flex-col">
        <div class="h-3 w-16 {BAR}"></div>
        <div class="h-[18px] w-12 {BAR}"></div>
      </div>
    {/each}
  </div>
{:else}
  <section
    class="flex animate-pulse flex-col gap-4 px-4 py-6 motion-reduce:animate-none"
  >
    <div class="h-5 w-40 {BAR}"></div>
    <div class="h-32 {BAR}"></div>
  </section>
  <section
    class="flex animate-pulse flex-col gap-4 px-4 py-6 motion-reduce:animate-none"
  >
    <div class="flex items-center justify-between">
      <div class="h-5 w-24 {BAR}"></div>
      <div class="h-8 w-32 rounded-full bg-secondary"></div>
    </div>
    {#each { length: 4 } as _, row (row)}
      <div class="h-5 {BAR}"></div>
    {/each}
  </section>
{/if}
