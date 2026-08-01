import { cva } from "class-variance-authority";

export { default as StatusBadge } from "./StatusBadge.vue";

/*
 * Status is a domain colour, not a semantic role, so it is consumed through a
 * `data-status` attribute variant rather than aliased into the semantic tier.
 * Anything not named here falls back to the muted default, which is what an
 * unrecognised provider state should look like.
 */
export const statusBadgeVariants = cva(
  "inline-flex items-center gap-[0.35rem] rounded-full bg-surface-raised px-[0.45rem] py-[0.2rem] text-[0.58rem] font-[650] whitespace-nowrap text-text-muted capitalize data-[status=running]:text-accent-strong data-[status=starting]:text-accent-strong data-[status=needs-input]:text-warning data-[status=waiting]:text-warning data-[status=failed]:text-danger",
);
