import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cn } from "@carcassonne/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-[var(--r-control)] border-0 text-sm font-medium whitespace-nowrap transition-[background-color,color,transform] duration-[var(--dur-fast)] select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)] active:not-disabled:scale-[var(--press-scale)] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary font-semibold text-primary-foreground hover:bg-[color-mix(in_oklch,var(--primary)_90%,black)]",
        outline:
          "bg-[var(--fill)] text-[var(--text-1)] hover:bg-[var(--fill-hover)] aria-expanded:bg-[var(--fill-active)] aria-expanded:text-[var(--text-accent)]",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "text-[var(--text-2)] hover:bg-[var(--fill)] hover:text-[var(--text-1)] aria-expanded:bg-[var(--fill-active)]",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "font-medium text-[var(--text-accent)] underline decoration-1 underline-offset-[3px] decoration-[color-mix(in_oklch,currentColor_45%,transparent)] hover:decoration-current",
      },
      size: {
        default:
          "h-10 gap-2 px-4",
        xs: "h-6 gap-1 rounded-[var(--r-inner)] px-2 text-[13px] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-[var(--r-inner)] px-3 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-12 gap-2 px-6 text-base",
        icon: "size-10",
        "icon-xs": "size-6 rounded-[var(--r-inner)] [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 rounded-[var(--r-inner)]",
        "icon-lg": "size-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
