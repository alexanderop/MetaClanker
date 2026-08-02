import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";

export { default as Button } from "./Button.vue";

export const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-sm font-semibold outline-none focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-accent-strong disabled:cursor-not-allowed disabled:opacity-40",
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-ink hover:not-disabled:bg-accent-strong",
        secondary: "border border-border bg-surface text-text hover:not-disabled:bg-surface-raised",
        outline:
          "border border-border bg-transparent text-inherit hover:not-disabled:bg-surface-raised",
        ghost:
          "bg-transparent text-text-muted hover:not-disabled:bg-canvas hover:not-disabled:text-text",
        danger: "bg-danger text-text-inverse hover:not-disabled:brightness-110",
        // A row in a chooser — a directory, a palette command, a project. Reads as
        // body text at rest and only gains a surface on hover.
        list: "justify-start rounded-sm bg-transparent text-left font-normal whitespace-normal text-text hover:not-disabled:bg-canvas",
      },
      size: {
        default: "min-h-9 px-3 py-2 text-sm",
        sm: "min-h-7 rounded-xs px-2 py-1 text-xs",
        icon: "size-8 p-0 text-xl",
        "icon-sm": "size-7 rounded-xs p-0",
        list: "min-h-10.5 w-full px-3 py-2 text-base",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "default",
    },
  },
);

export type ButtonVariants = VariantProps<typeof buttonVariants>;
