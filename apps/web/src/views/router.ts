import { createRouter, createWebHistory } from "vue-router";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { name: "home", path: "/", component: () => import("./WelcomeView.vue") },
    { name: "thread", path: "/threads/:threadId", component: () => import("./WorkspaceView.vue") },
  ],
});
