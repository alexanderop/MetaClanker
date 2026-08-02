import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";

export { default as ProviderMark } from "./ProviderMark.vue";

/*
 * Provider identity is a domain colour rather than a semantic role, so it is
 * selected by `data-provider` and never aliased into the semantic token tier.
 * Codex is the default because it is the fallback provider everywhere else too.
 */
export const providerMarkVariants = cva(
  "grid flex-none place-items-center rounded-sm bg-codex font-extrabold text-accent-ink data-[provider=claude]:bg-claude",
  {
    variants: {
      size: {
        default: "size-10",
        sm: "size-6.5 text-xs",
      },
    },
    defaultVariants: {
      size: "default",
    },
  },
);

export type ProviderMarkVariants = VariantProps<typeof providerMarkVariants>;
