import { createPinia } from "pinia";
import { createApp } from "vue";

import App from "./App.vue";
import { createAppAtomModel } from "./app-atom-model.js";
import { i18n } from "./shared/i18n.js";
import { router } from "./views/router.js";
import "./shared/styles.css";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";

const atomModel = createAppAtomModel();
const app = createApp(App).use(atomModel.plugin).use(createPinia()).use(router).use(i18n);
app.mount("#app");

let disposed = false;
const disposeApp = (): void => {
  if (disposed) return;
  disposed = true;
  app.unmount();
  atomModel.dispose();
};

window.addEventListener("pagehide", disposeApp, { once: true });
import.meta.hot?.dispose(disposeApp);
