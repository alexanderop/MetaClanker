import { inject, type InjectionKey } from "vue";

import type { ClientAtomModel } from "./create-client-atom-model.js";

export const clientAtomModelKey: InjectionKey<ClientAtomModel> = Symbol(
  "@metaclanker/web/client-atom-model",
);

/** Project guard: application code never falls through to Atom Vue's default registry. */
export const useClientAtomModel = (): ClientAtomModel => {
  const model = inject(clientAtomModelKey);
  if (model === undefined) {
    throw new Error("MetaClanker client atom model was not provided for this app mount");
  }
  return model;
};
