import type { Component, Plugin } from "vue";
import type { RenderResult } from "vitest-browser-vue";
import { render } from "vitest-browser-vue";

type RenderFeatureOptions = NonNullable<Parameters<typeof render>[1]>;
export interface RenderFeatureModel {
  readonly plugin: Plugin;
  readonly dispose: () => void;
}
type Options = RenderFeatureOptions & { readonly atomModel?: RenderFeatureModel };

/**
 * The one browser-feature render boundary. Callers supply real application
 * plugins; this helper intentionally exposes no component internals.
 */
export const renderFeature = async (
  component: Component,
  options: Options = {},
): Promise<RenderResult<Record<string, unknown>>> => {
  const { atomModel, global, ...renderOptions } = options;
  const plugins =
    atomModel === undefined ? global?.plugins : [atomModel.plugin, ...(global?.plugins ?? [])];
  const nextGlobal = plugins === undefined ? global : { ...global, plugins };
  const result = await render(component, {
    ...renderOptions,
    ...(nextGlobal === undefined ? {} : { global: nextGlobal }),
  });
  const unmount = result.unmount.bind(result);
  return {
    ...result,
    async unmount() {
      await unmount();
      atomModel?.dispose();
    },
  };
};
