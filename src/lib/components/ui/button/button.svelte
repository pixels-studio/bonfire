<script lang="ts" module>
  import { type VariantProps, tv } from 'tailwind-variants';
  import { cn, type WithElementRef } from '$lib/utils.js';
  import type {
    HTMLAnchorAttributes,
    HTMLButtonAttributes,
  } from 'svelte/elements';

  export const buttonVariants = tv({
    base: "focus-visible:ring-ring/60 rounded-full border border-transparent bg-clip-padding backdrop-blur-xs text-sm font-medium leading-5 focus-visible:ring-2 active:not-aria-[haspopup]:scale-[0.97] [&_svg:not([class*='size-'])]:size-4 group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-[color,background-color,border-color,opacity,transform] duration-150 ease-out outline-none select-none disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0",
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/80',
        outline:
          'border-border bg-clip-border bg-foreground/8 hover:bg-foreground/12 focus-visible:bg-foreground/12 aria-expanded:bg-foreground/12',
        secondary:
          'bg-clip-border bg-foreground/8 text-foreground hover:bg-foreground/12 focus-visible:bg-foreground/12 aria-expanded:bg-foreground/12',
        ghost:
          'bg-clip-border bg-foreground/8 text-foreground hover:bg-foreground/12 focus-visible:bg-foreground/12 aria-expanded:bg-foreground/12',
        destructive:
          'bg-destructive/10 hover:bg-destructive/20 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/20 text-destructive focus-visible:border-destructive/40 dark:hover:bg-destructive/30',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default:
          'gap-1.5 px-3 py-1.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        xs: "h-6 gap-1 px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 px-2.5 text-[0.8rem] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: 'h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        icon: 'p-1.5',
        'icon-xs': "size-6 [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-7',
        'icon-lg': 'size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  });

  export type ButtonVariant = VariantProps<typeof buttonVariants>['variant'];
  export type ButtonSize = VariantProps<typeof buttonVariants>['size'];

  export type ButtonProps = WithElementRef<HTMLButtonAttributes> &
    WithElementRef<HTMLAnchorAttributes> & {
      variant?: ButtonVariant;
      size?: ButtonSize;
      /** Swaps the label for a spinner without changing the button's width. */
      loading?: boolean;
    };
</script>

<script lang="ts">
  let {
    class: className,
    variant = 'default',
    size = 'default',
    ref = $bindable(null),
    href = undefined,
    type = 'button',
    disabled,
    loading = false,
    children,
    ...restProps
  }: ButtonProps = $props();
</script>

{#snippet content()}
  {#if loading}
    <span class="contents invisible">{@render children?.()}</span>
    <span class="absolute inset-0 grid place-items-center" aria-hidden="true">
      <span
        class="size-4 animate-spin rounded-full border-2 border-current/30 border-t-current motion-reduce:animate-pulse"
      ></span>
    </span>
  {:else}
    {@render children?.()}
  {/if}
{/snippet}

{#if href}
  <a
    bind:this={ref}
    data-slot="button"
    class={cn(buttonVariants({ variant, size }), className)}
    href={disabled ? undefined : href}
    aria-disabled={disabled}
    role={disabled ? 'link' : undefined}
    tabindex={disabled ? -1 : undefined}
    {...restProps}
  >
    {@render content()}
  </a>
{:else}
  <button
    bind:this={ref}
    data-slot="button"
    class={cn(
      buttonVariants({ variant, size }),
      loading && 'relative disabled:opacity-100!',
      className,
    )}
    {type}
    disabled={disabled || loading}
    aria-busy={loading || undefined}
    {...restProps}
  >
    {@render content()}
  </button>
{/if}
