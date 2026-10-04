<script lang="ts" module>
  import type { Skill } from '$shared/contracts';

  /** Most matches listed at once; typing more narrows the rest. */
  const MAX_MATCHES = 50;

  /**
   * Skills matching what was typed after `/`, best first: an exact name, then names that
   * start with it (or whose part after a plugin's `plugin:` prefix does), then names and
   * finally descriptions that contain it. Skills already attached are left out.
   */
  export function matchSkills(
    skills: Skill[],
    query: string,
    attached: Skill[],
  ): Skill[] {
    const typed = query.toLowerCase();
    const taken = new Set(attached.map(({ name }) => name));
    const rank = ({ name, description }: Skill) => {
      const lower = name.toLowerCase();
      if (lower === typed) return 0;
      if (lower.startsWith(typed)) return 1;
      if (lower.split(':').at(-1)?.startsWith(typed)) return 2;
      if (lower.includes(typed)) return 3;
      if (description.toLowerCase().includes(typed)) return 4;
      return -1;
    };
    return skills
      .filter(({ name }) => !taken.has(name))
      .map((skill) => ({ skill, rank: rank(skill) }))
      .filter(({ rank }) => rank >= 0)
      .sort(
        (a, b) => a.rank - b.rank || a.skill.name.localeCompare(b.skill.name),
      )
      .slice(0, MAX_MATCHES)
      .map(({ skill }) => skill);
  }
</script>

<script lang="ts">
  import { overlayScrollbar } from '$lib/scrollbar';
  import { cn } from '$lib/utils';

  let {
    id,
    matches,
    highlighted = $bindable(),
    loading,
    error,
    onchoose,
  }: {
    /** The listbox id, which the text box points at. */
    id: string;
    matches: Skill[];
    highlighted: number;
    loading: boolean;
    error: string;
    onchoose: (skill: Skill) => void;
  } = $props();

  let list = $state<HTMLUListElement>();

  // Keeps the highlighted skill in view as the arrow keys move through a long list.
  $effect(() => {
    list
      ?.querySelector(`#${CSS.escape(`${id}-${highlighted}`)}`)
      ?.scrollIntoView({ block: 'nearest' });
  });
</script>

<div
  class="absolute inset-x-0 bottom-full z-50 mb-2 overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10"
>
  {#if matches.length}
    <ul
      {@attach overlayScrollbar}
      bind:this={list}
      {id}
      role="listbox"
      aria-label="Skills"
      class="max-h-72 overflow-y-auto p-1"
    >
      {#each matches as skill, index (skill.name)}
        <!-- Focus stays in the text box, which handles the keys, so items only take clicks. -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <li
          id={`${id}-${index}`}
          role="option"
          aria-selected={index === highlighted}
          class={cn(
            'flex cursor-default rounded-md px-2.5 py-1.5',
            index === highlighted && 'bg-muted',
          )}
          onmousedown={(event) => event.preventDefault()}
          onmousemove={() => (highlighted = index)}
          onclick={() => onchoose(skill)}
        >
          <span class="truncate text-sm font-medium">/{skill.name}</span>
        </li>
      {/each}
    </ul>
  {:else if loading && !error}
    <div class="p-1" role="status" aria-label="Loading skills">
      {#each [60, 45, 70, 50, 55] as width}
        <div class="px-2.5 py-2">
          <div
            class="h-4 animate-pulse rounded bg-muted"
            style:width={`${width}%`}
          ></div>
        </div>
      {/each}
    </div>
  {:else}
    <p class="px-3.5 py-2.5 text-sm text-muted-foreground" role="status">
      {error ? `Couldn't load skills: ${error}` : 'No matching skills'}
    </p>
  {/if}
</div>
