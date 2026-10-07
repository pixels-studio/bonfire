<script lang="ts">
  import { RadioGroup } from 'bits-ui';
  import type { SettingControlProps } from './setting.svelte';
  import { WALLPAPERS } from '$lib/wallpapers';

  let {
    value,
    onchange,
    ...controlProps
  }: SettingControlProps & {
    value: string;
    onchange: (id: string) => void;
  } = $props();
</script>

<RadioGroup.Root
  {...controlProps}
  {value}
  onValueChange={onchange}
  orientation="horizontal"
  class="grid grid-cols-4 gap-2"
>
  {#each WALLPAPERS as wallpaper (wallpaper.id)}
    <RadioGroup.Item
      value={wallpaper.id}
      aria-label={wallpaper.name}
      class="group flex flex-col gap-1.5 rounded-md text-left outline-none"
    >
      <span
        class="relative block aspect-video overflow-hidden rounded-md bg-background outline-1 -outline-offset-1 outline-border transition-[outline-color] duration-150 group-hover:outline-foreground/30 group-focus-visible:outline-2 group-focus-visible:outline-ring group-data-[state=checked]:outline-2 group-data-[state=checked]:-outline-offset-2 group-data-[state=checked]:outline-foreground motion-reduce:transition-none"
      >
        {#if wallpaper.thumb}
          <img
            src={wallpaper.thumb}
            alt=""
            draggable="false"
            loading="lazy"
            class="size-full object-cover"
          />
          <!-- The gradient the task view uses, so the pair is chosen together. -->
          <span
            class="absolute inset-y-0 right-0 w-1/3"
            style:background={wallpaper.gradient}
          ></span>
        {/if}
      </span>
      <span
        class="text-xs text-muted-foreground group-data-[state=checked]:text-foreground"
      >
        {wallpaper.name}
      </span>
    </RadioGroup.Item>
  {/each}
</RadioGroup.Root>
