import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";

export { default as Card } from "./Card.vue";

export const cardVariants = cva("rounded-md border", {
  variants: {
    tone: {
      default: "border-border bg-surface",
      // A card that is asking for something, not reporting something.
      warning:
        "border-[color-mix(in_srgb,var(--color-warning)_55%,var(--color-border))] bg-[color-mix(in_srgb,var(--color-warning)_7%,var(--color-surface))]",
    },
  },
  defaultVariants: {
    tone: "default",
  },
});

export type CardVariants = VariantProps<typeof cardVariants>;
