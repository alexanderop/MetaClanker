import type { Component } from "vue";
import { render } from "vitest-browser-vue";

type RenderFeatureOptions = NonNullable<Parameters<typeof render>[1]>;

/**
 * The one browser-feature render boundary. Callers supply real application
 * plugins; this helper intentionally exposes no component internals.
 */
export const renderFeature = (component: Component, options: RenderFeatureOptions) =>
  render(component, options);
