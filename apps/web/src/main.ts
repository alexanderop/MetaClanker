import { createPinia } from "pinia";
import { createApp } from "vue";

import App from "./App.vue";
import { i18n } from "./shared/i18n.js";
import { router } from "./views/router.js";
import "./shared/styles.css";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";

createApp(App).use(createPinia()).use(router).use(i18n).mount("#app");
