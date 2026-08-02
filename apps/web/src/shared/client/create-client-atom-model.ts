import { Atom, AtomRegistry } from "@effect/atom-vue";
import type * as Layer from "effect/Layer";
import * as LayerApi from "effect/Layer";

import type { Client } from "./http.js";

export interface ClientAtomModel {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly runtime: Atom.AtomRuntime<Client>;
  readonly dispose: () => void;
}

export const createClientAtomModel = (clientLayer: Layer.Layer<Client>): ClientAtomModel => {
  const registry = AtomRegistry.make();
  const runtimeFactory = Atom.context({ memoMap: LayerApi.makeMemoMapUnsafe() });
  const runtime = runtimeFactory(LayerApi.fresh(clientLayer));
  let disposed = false;

  return {
    registry,
    runtime,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      registry.dispose();
    },
  };
};
