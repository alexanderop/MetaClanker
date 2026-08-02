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
      default: "min-h-10 px-3 py-2.5 text-base",
      sm: "min-h-9 w-full px-2 py-1.5 text-sm",
    },
  },
  defaultVariants: {
    size: "default",
  },
});

export type ControlVariants = VariantProps<typeof controlVariants>;
