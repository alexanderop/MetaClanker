import { registryKey } from "@effect/atom-vue";
import type { Plugin } from "vue";

import { createReviewAtomModel, reviewAtomModelKey } from "./features/conversation/review-model.js";
import { createClientAtomModel } from "./shared/client/create-client-atom-model.js";
import type { BrowserClientLayerOptions } from "./shared/client/http.js";
import { browserClientLayer } from "./shared/client/http.js";
import { clientAtomModelKey } from "./shared/client/provider.js";

export interface AppAtomModel {
  readonly plugin: Plugin;
  readonly client: ReturnType<typeof createClientAtomModel>;
  readonly review: ReturnType<typeof createReviewAtomModel>;
  readonly dispose: () => void;
}

export const createAppAtomModel = (clientOptions: BrowserClientLayerOptions = {}): AppAtomModel => {
  const client = createClientAtomModel(browserClientLayer(clientOptions));
  const review = createReviewAtomModel(client);
  const plugin: Plugin = {
    install(app) {
      app.provide(registryKey, client.registry);
      app.provide(clientAtomModelKey, client);
      app.provide(reviewAtomModelKey, review);
      app.onUnmount(client.dispose);
    },
  };
  return { plugin, client, review, dispose: client.dispose };
};
