import type { ClassValue } from "clsx";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merges variant classes with caller-supplied ones so the caller always wins.
 * Every primitive in `src/ui` accepts a `class` prop and funnels it through here;
 * that is the escape hatch that keeps a component reusable instead of forked.
 */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));
