import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";

/*
 * The box shared by every native form control we style — `Input` and `NativeSelect`
 * today. It lives beside `cn` rather than inside one component's `index.ts` because
 * an input and a select sitting in the same row have to be the same object; owning
 * the table twice is how they drift apart.
 */
export const controlVariants = cva("rounded-sm border border-border bg-surface-raised text-text", {
  variants: {
    size: {
      default: "min-h-[2.55rem] px-[0.7rem] py-[0.6rem] text-[0.75rem]",
      sm: "min-h-[2.25rem] w-full px-[0.55rem] py-[0.4rem] text-[0.68rem]",
    },
  },
  defaultVariants: {
    size: "default",
  },
});

export type ControlVariants = VariantProps<typeof controlVariants>;
