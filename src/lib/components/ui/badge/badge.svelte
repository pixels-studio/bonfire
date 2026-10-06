<script lang="ts" module>
  import { type VariantProps, tv } from 'tailwind-variants';
  import type { HTMLAttributes } from 'svelte/elements';
  import type { WithElementRef } from '$lib/utils.js';

  export const badgeVariants = tv({
    base: 'inline-flex w-fit shrink-0 items-center justify-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground',
        secondary: 'bg-secondary text-secondary-foreground',
        muted: 'bg-muted text-muted-foreground',
        outline: 'border border-border text-foreground',
      },
    },
    defaultVariants: {
      variant: 'secondary',
    },
  });

  export type BadgeVariant = VariantProps<typeof badgeVariants>['variant'];

  export type BadgeProps = WithElementRef<HTMLAttributes<HTMLSpanElement>> & {
    variant?: BadgeVariant;
  };
</script>

<script lang="ts">
  import { cn } from '$lib/utils.js';

  let {
    ref = $bindable(null),
    class: className,
    variant = 'secondary',
    children,
    ...restProps
  }: BadgeProps = $props();
</script>

<span
  bind:this={ref}
  class={cn(badgeVariants({ variant }), className)}
  {...restProps}
>
  {@render children?.()}
</span>
