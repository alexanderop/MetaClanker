import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";

export { default as Button } from "./Button.vue";

export const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-[0.4rem] whitespace-nowrap rounded-sm font-[650] outline-none focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-accent-strong disabled:cursor-not-allowed disabled:opacity-40",
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
        default: "min-h-[2.2rem] px-[0.8rem] py-[0.46rem] text-[0.7rem]",
        sm: "min-h-[1.8rem] rounded-[0.4rem] px-[0.48rem] py-[0.25rem] text-[0.62rem]",
        icon: "size-8 p-0 text-base",
        "icon-sm": "size-[1.7rem] rounded-[0.4rem] p-0",
        list: "min-h-[2.6rem] w-full px-[0.7rem] py-[0.55rem] text-[0.75rem]",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "default",
    },
  },
);

export type ButtonVariants = VariantProps<typeof buttonVariants>;
